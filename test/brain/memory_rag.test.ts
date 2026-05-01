import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore } from "../../src/memory/memory.js";
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

  it("skips corrupt recent JSONL lines while preserving readable entries", async () => {
    await writeFile(
      path.join(testRootDir, "discord", "channels", "c1", "recent.jsonl"),
      [
        JSON.stringify({ id: "ok-1", timestamp: 1, source: "discord", type: "message", text: "first good line" }),
        "{not-json",
        JSON.stringify({ id: "ok-2", timestamp: 2, source: "discord", type: "message", text: "second good line" }),
      ].join("\n"),
      "utf8",
    );
    const store = new MemoryStore({ rootDir: testRootDir });

    const entries = await store.readRecent({ kind: "discord_channel", channelId: "c1" }, 10);

    expect(entries.map((entry) => entry.id)).toEqual(["ok-1", "ok-2"]);
  });

  it("searches long-term memory layers", async () => {
    const store = new MemoryStore({ rootDir: testRootDir });
    await store.writeLongTerm("profile", "User likes Trashcan lore and quiet jokes.", "user_facts");

    const results = await store.searchHistory({ kind: "long_term" }, { text: "Trashcan", layers: ["user_facts"] });

    expect(results.length).toBe(1);
    expect(results[0].excerpt).toContain("LongTerm:user_facts/profile");
  });

  it("does not let a repeated single keyword outrank broader relevance", async () => {
    await writeFile(
      path.join(testRootDir, "discord", "channels", "c1", "recent.jsonl"),
      [
        JSON.stringify({
          id: "keyword-spam",
          timestamp: 1,
          source: "discord",
          type: "message",
          text: "Trashcan trashcan trashcan trashcan but no useful context.",
        }),
        JSON.stringify({
          id: "semantic-match",
          timestamp: 2,
          source: "discord",
          type: "message",
          text: "March connected Trashcan lore with quiet jokes and Express crew habits.",
        }),
      ].join("\n"),
      "utf8",
    );
    const store = new MemoryStore({ rootDir: testRootDir });

    const results = await store.searchHistory(
      { kind: "discord_channel", channelId: "c1" },
      { text: "Trashcan quiet jokes Express", limit: 5 },
    );

    expect(results[0].excerpt).toContain("March connected");
    expect(results.some((result) => result.excerpt.includes("keyword-spam"))).toBe(false);
  });

  it("can approve memory proposals into long-term memory", async () => {
    const store = new MemoryStore({ rootDir: testRootDir });
    const proposalId = await store.proposeMemory({
      authorId: "owner",
      source: "test",
      content: "Owner prefers concise memory summaries.",
      reason: "explicit preference",
      layer: "user_facts",
    });

    await store.approveMemoryProposal(proposalId, { targetKey: "owner_profile", decidedBy: "test" });

    const value = await store.readLongTerm("owner_profile", "user_facts");
    const pending = await store.listMemoryProposals(10, "pending");
    expect(value).toContain("Owner prefers concise memory summaries.");
    expect(pending).toHaveLength(0);
  });
});
