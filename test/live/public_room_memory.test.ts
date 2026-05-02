import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PublicRoomMemoryStore } from "../../src/capabilities/program/stage_director/public_memory.js";

describe("PublicRoomMemoryStore", () => {
  it("stores only public room memories", async () => {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "stelle-public-memory-")), "mem.jsonl");
    const store = new PublicRoomMemoryStore(file);

    await store.append({ title: "规则", summary: "只保留低敏节目设定", source: "manual" });
    const memories = await store.list();

    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({ sensitivity: "public", title: "规则" });
  });
});
