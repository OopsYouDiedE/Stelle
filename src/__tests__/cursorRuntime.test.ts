import assert from "node:assert/strict";
import test from "node:test";

import { CursorRegistry, CursorRuntime, echoTool, InnerCursor, TestCursor, ToolRegistry } from "../index.js";

function createRuntime(): CursorRuntime {
  const cursors = new CursorRegistry();
  cursors.register(new InnerCursor());
  cursors.register(new TestCursor());

  const tools = new ToolRegistry();
  tools.register(echoTool);

  return new CursorRuntime(cursors, tools);
}

test("CursorRuntime starts and observes a cursor without Core Mind", async () => {
  const runtime = createRuntime();

  const attach = await runtime.startCursor("test", "standalone cursor test");
  assert.equal(attach.state.cursorId, "test");
  assert.equal(attach.state.attached, true);
  assert.equal(attach.tools.tools[0]?.name, "echo");

  const observation = await runtime.observe("test");
  assert.equal(observation.cursorId, "test");
  assert.ok(observation.stream.some((item) => item.content === "Test Cursor initialized."));

  const reports = runtime.drainReports();
  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.type, "runtime_start");
});

test("CursorRuntime sends passive input to a standalone cursor and collects reports", async () => {
  const runtime = createRuntime();
  await runtime.startCursor("test");
  runtime.drainReports();

  const reports = await runtime.sendInput("test", {
    type: "text",
    content: "hello from runtime",
  });
  assert.equal(reports[0]?.type, "passive_response");

  const observation = await runtime.observe("test");
  assert.ok(observation.stream.some((item) => item.content === "Passive input: hello from runtime"));

  const drained = runtime.drainReports();
  assert.equal(drained.length, 1);
  assert.equal(drained[0]?.needsAttention, false);
});

test("CursorRuntime surfaces standalone cursor escalation reports", async () => {
  const runtime = createRuntime();
  await runtime.startCursor("test");
  runtime.drainReports();

  const reports = await runtime.sendInput("test", {
    type: "text",
    content: "high risk",
    metadata: { risk: "high" },
  });

  assert.equal(reports[0]?.type, "escalation");
  assert.equal(reports[0]?.needsAttention, true);
  assert.equal(runtime.snapshot().pendingReports.length, 1);
});

test("CursorRuntime executes only tools exposed by the target cursor", async () => {
  const runtime = createRuntime();
  await runtime.startCursor("test");

  const allowed = await runtime.useCursorTool("test", "test.echo", { text: "cursor owned call" });
  assert.equal(allowed.ok, true);
  assert.deepEqual(allowed.data, { text: "cursor owned call" });
  assert.equal(runtime.audit.records.length, 1);
  assert.equal(runtime.audit.records[0]?.caller, "cursor");

  const denied = await runtime.useCursorTool("inner", "test.echo", { text: "not exposed" });
  assert.equal(denied.ok, false);
  assert.equal(denied.error?.code, "tool_not_exposed_by_cursor");
});

test("CursorRuntime tick reports skipped work when background ticking is not allowed", async () => {
  const runtime = createRuntime();
  await runtime.startCursor("test");
  runtime.drainReports();

  const reports = await runtime.tick("test");
  assert.equal(reports[0]?.type, "tick_skipped");
  assert.equal(reports[0]?.severity, "debug");
  assert.equal(runtime.drainReports()[0]?.type, "tick_skipped");
});
