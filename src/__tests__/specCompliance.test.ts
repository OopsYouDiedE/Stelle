import assert from "node:assert/strict";
import test from "node:test";

import {
  AsyncConfigStore,
  CoreMind,
  CursorRegistry,
  DiscordAttachedCoreMind,
  TestCursor,
  ToolRegistry,
  createDefaultToolRegistry,
} from "../index.js";
import type { CursorConfig, ToolDefinition } from "../index.js";

test("ToolRegistry converts thrown tool errors into audited ToolResult failures", async () => {
  const registry = new ToolRegistry();
  const throwingTool: ToolDefinition = {
    identity: { namespace: "test", name: "throws", authorityClass: "cursor" },
    description: { summary: "Throws during execution.", whenToUse: "Test only." },
    inputSchema: { type: "object", properties: {} },
    sideEffects: {
      externalVisible: false,
      writesFileSystem: false,
      networkAccess: false,
      startsProcess: false,
      changesConfig: false,
      consumesBudget: false,
      affectsUserState: false,
    },
    authority: { level: "read", scopes: ["test"], requiresUserConfirmation: false },
    execute() {
      throw new Error("boom");
    },
  };
  registry.register(throwingTool);
  const audit = { records: [] as unknown[], record(record: unknown) { this.records.push(record); } };

  const result = await registry.execute("test.throws", {}, {
    caller: "cursor",
    authority: { caller: "cursor", allowedAuthorityClasses: ["cursor"] },
    audit,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "tool_execution_failed");
  assert.equal(audit.records.length, 1);
});

test("Cursor config async save failures become observable state and stream events", async () => {
  const store = new AsyncConfigStore<CursorConfig>("..\\outside\\cursor.json", process.cwd());
  const cursor = new TestCursor({ configStore: store });

  await cursor.updateConfig({ behavior: { x: 1 } }, "force failing save");
  await new Promise((resolve) => setTimeout(resolve, 20));

  const state = cursor.getState();
  assert.equal(state.status, "error");
  const observation = await cursor.observe();
  assert.ok(observation.stream.some((item) => item.metadata?.configSaveFailed));
});

test("default tool registry includes migrated search tools and browser compatibility tools", () => {
  const registry = createDefaultToolRegistry();
  const tools = registry.list().map((tool) => `${tool.namespace}.${tool.name}`);

  assert.ok(tools.includes("search.web_search"));
  assert.ok(tools.includes("search.web_read"));
  assert.ok(tools.includes("browser.open_page"));
  assert.ok(tools.includes("browser.screenshot"));
});

test("DiscordAttachedCoreMind keeps Core Mind defaulted to Inner Cursor without a model key", async () => {
  const app = new DiscordAttachedCoreMind({ apiKey: "", model: "local-test-model" });
  app.core = await CoreMind.create({
    cursors: app.cursors,
    tools: app.tools,
    defaultCursorId: app.innerCursor.identity.id,
  });

  assert.equal(app.core.attachment.currentCursorId, "inner");
  assert.equal(app.core.attachment.mode, "inner");
  const reply = await app.generateReply("@Stelle hello");
  assert.ok(reply.length > 0);
});

test("CoreMind sees only current cursor tools plus Stelle tools in its tool view", async () => {
  const cursors = new CursorRegistry();
  cursors.register(new TestCursor());
  const tools = createDefaultToolRegistry(cursors);
  const core = await CoreMind.create({ cursors, tools, defaultCursorId: "test" });

  assert.ok(core.toolView.cursorTools.some((tool) => `${tool.namespace}.${tool.name}` === "test.echo"));
  assert.ok(core.toolView.stelleTools.some((tool) => `${tool.namespace}.${tool.name}` === "system.run_command"));
  assert.ok(!core.toolView.cursorTools.some((tool) => tool.authorityClass !== "cursor"));
});
