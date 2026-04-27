import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore } from "../../src/utils/memory.js";
import { rm, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

describe("Memory Extraction & RAG Test", () => {
  const testRootDir = path.resolve("memory_rag_test");

  beforeEach(async () => {
    await rm(testRootDir, { recursive: true, force: true });
    await mkdir(testRootDir, { recursive: true });
    await mkdir(path.join(testRootDir, "discord", "channels", "c1"), { recursive: true });

    // 预埋一份结构化历史数据
    const mockHistory = `
## 2026-04-24T10:00:00Z | discord:c1
Participants: [March, DanHeng]
Keywords: [Express, Trashcan, Credits]
Summary: Discussion about the next destination and potential loot.
--- RAW FRAGMENTS ---
March: Look at that shiny trashcan!
    `;
    await writeFile(path.join(testRootDir, "discord", "channels", "c1", "history.md"), mockHistory, "utf8");
  });

  it("should find relevant history by keyword", async () => {
    const store = new MemoryStore({ rootDir: testRootDir });
    const results = await store.searchHistory({ kind: "discord_channel", channelId: "c1" }, { keywords: ["Trashcan"] });
    
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].excerpt).toContain("Discussion about the next destination");
  });
});
