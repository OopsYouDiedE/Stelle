import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  AsyncConfigStore,
  CoreMind,
  CursorRegistry,
  echoTool,
  InnerCursor,
  MemoryAuditSink,
  TestCursor,
  ToolRegistry,
  transferContext,
} from "../index.js";

test("ToolRegistry registers, validates, executes, and audits cursor tools", async () => {
  const registry = new ToolRegistry();
  registry.register(echoTool);
  const audit = new MemoryAuditSink();

  const result = await registry.execute(
    "test.echo",
    { text: "hello" },
    {
      caller: "cursor",
      cursorId: "test",
      authority: { caller: "cursor", allowedAuthorityClasses: ["cursor"] },
      audit,
    }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { text: "hello" });
  assert.equal(audit.records.length, 1);
  assert.equal(audit.records[0]?.ok, true);

  const invalid = await registry.execute(
    "test.echo",
    {},
    {
      caller: "cursor",
      cursorId: "test",
      authority: { caller: "cursor", allowedAuthorityClasses: ["cursor"] },
      audit,
    }
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error?.code, "invalid_input");
});

test("CursorRegistry exposes safe Core Mind cursor views", () => {
  const cursors = new CursorRegistry();
  cursors.register(new InnerCursor());
  cursors.register(new TestCursor());

  const view = cursors.view();
  assert.equal(view.length, 2);
  assert.deepEqual(
    view.map((cursor) => cursor.cursorId).sort(),
    ["inner", "test"]
  );
  assert.ok(view.every((cursor) => cursor.canAttach));
});

test("CoreMind attaches to inner cursor, switches with Context Transfer, and uses cursor tool", async () => {
  const cursors = new CursorRegistry();
  cursors.register(new InnerCursor());
  cursors.register(new TestCursor());

  const tools = new ToolRegistry();
  tools.register(echoTool);

  const core = await CoreMind.create({ cursors, tools, defaultCursorId: "inner" });
  assert.equal(core.attachment.currentCursorId, "inner");
  assert.equal(core.attachment.mode, "inner");

  await core.switchCursor("test", "unit test switch");
  assert.equal(core.attachment.currentCursorId, "test");
  assert.equal(core.attachment.previousCursorId, "inner");
  assert.equal(core.continuity.recentSnapshots.length, 1);

  const observation = await core.observeCurrentCursor();
  assert.equal(observation.cursorId, "test");
  assert.ok(observation.stream.some((item) => item.source === "context_transfer"));

  const toolsView = core.toolView;
  assert.equal(toolsView.cursorTools.length, 1);
  assert.equal(toolsView.cursorTools[0]?.namespace, "test");

  const result = await core.useTool("test.echo", { text: "through core" });
  assert.equal(result.ok, true);
  assert.equal(core.audit.records.length, 1);
  assert.ok(core.decisions.some((decision) => decision.type === "use_tool"));
});

test("Context Transfer produces runtime prompt and summarized stream", () => {
  const context = transferContext({
    from: {
      cursorId: "source",
      kind: "test",
      timestamp: 1,
      stateSummary: "source summary",
      recentStream: [],
      resourceRefs: [{ id: "r1", kind: "summary", summary: "resource summary" }],
      pendingItems: [],
    },
    targetCursorId: "target",
    reason: "switch",
    targetToolNamespaces: ["test"],
  });

  assert.equal(context.runtimePrompt.cursorId, "target");
  assert.ok(context.runtimePrompt.rules.length > 0);
  assert.equal(context.transferredStream.length, 2);
  assert.equal(context.transferredStream[0]?.type, "summary");
  assert.equal(context.transferredStream[1]?.type, "resource");
});

test("AsyncConfigStore serializes latest config and redacts secret-like fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "stelle-config-"));
  try {
    const filePath = join(root, "cursor.json");
    const store = new AsyncConfigStore<Record<string, unknown>>(filePath, root);
    await Promise.all([
      store.save({ version: "1", nested: { token: "first" } }),
      store.save({ version: "2", nested: { apiKey: "second" }, normal: "kept" }),
    ]);
    await store.flush();

    const saved = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    assert.equal(saved.version, "2");
    assert.equal(saved.normal, "kept");
    assert.deepEqual(saved.nested, { apiKey: "[redacted]" });
    assert.equal(store.isDirty, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TestCursor passive response escalates high-risk input and accepts low-risk input", async () => {
  const cursor = new TestCursor();
  const lowRiskReports = await cursor.passiveRespond({
    id: "input-1",
    type: "text",
    source: "unit",
    timestamp: Date.now(),
    content: "hello",
    trust: "external",
  });
  assert.equal(lowRiskReports[0]?.needsAttention, false);

  const highRiskReports = await cursor.passiveRespond({
    id: "input-2",
    type: "text",
    source: "unit",
    timestamp: Date.now(),
    content: "danger",
    trust: "external",
    metadata: { risk: "high" },
  });
  assert.equal(highRiskReports[0]?.type, "escalation");
  assert.equal(highRiskReports[0]?.needsAttention, true);
});
