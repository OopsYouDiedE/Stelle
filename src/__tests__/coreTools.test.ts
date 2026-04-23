import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { MemoryAuditSink, ToolRegistry, registerCoreTools } from "../index.js";
import type { ToolExecutionContext } from "../index.js";

function context(audit = new MemoryAuditSink(), cwd = process.cwd()): ToolExecutionContext {
  return {
    caller: "stelle" as const,
    cwd,
    authority: { caller: "stelle" as const, allowedAuthorityClasses: ["cursor", "stelle"] },
    audit,
  };
}

test("migrated core tools support basic, fs, memory, and meta operations", async () => {
  const root = await mkdtemp(join(tmpdir(), "stelle-tools-"));
  try {
    await writeFile(join(root, "note.txt"), "alpha\nbeta\nalpha", "utf8");
    const registry = new ToolRegistry();
    registerCoreTools(registry);
    const audit = new MemoryAuditSink();

    const calc = await registry.execute("basic.calculate", { expression: "2 + 3 * 4" }, context(audit, root));
    assert.equal(calc.ok, true);
    assert.equal(calc.data?.value, 14);

    const list = await registry.execute("fs.list_directory", {}, context(audit, root));
    assert.equal(list.ok, true);
    assert.equal((list.data?.items as { path: string }[])[0]?.path, "note.txt");

    const read = await registry.execute("fs.read_file", { file_path: "note.txt", start_line: 2, end_line: 3 }, context(audit, root));
    assert.equal(read.ok, true);
    assert.equal(read.data?.content, "beta\nalpha");

    const search = await registry.execute("fs.search_files", { query: "alpha" }, context(audit, root));
    assert.equal(search.ok, true);
    assert.equal((search.data?.matches as unknown[]).length, 2);

    const write = await registry.execute("fs.write_file", { file_path: "out.txt", content: "written" }, context(audit, root));
    assert.equal(write.ok, true);
    assert.equal(await readFile(join(root, "out.txt"), "utf8"), "written");

    const todo = await registry.execute("memory.todo", { todos: [{ id: "1", content: "ship", status: "pending" }] }, context(audit, root));
    assert.equal((todo.data?.todos as unknown[]).length, 1);

    const meta = await registry.execute("meta.show_available_tools", {}, context(audit, root));
    assert.equal(meta.ok, true);
    assert.ok((meta.data?.tools as unknown[]).length >= 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
