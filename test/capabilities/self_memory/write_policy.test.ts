import { describe, it, expect } from "vitest";
import { MemoryWritePolicy } from "../../../src/capabilities/self_memory/write_policy.js";

describe("MemoryWritePolicy", () => {
  const policy = new MemoryWritePolicy();

  it("should promote explicit user requests to long-term memory", () => {
    const result = policy.evaluate({ summary: "User requested to remember my birthday", kind: "episode" });
    expect(result.shouldWriteLongTerm).toBe(true);
    expect(result.importance).toBe(9);
  });

  it("should reject reflections without evidence", () => {
    const result = policy.evaluate({ kind: "reflection", evidenceRefs: [] });
    expect(result.shouldWriteLongTerm).toBe(false);
    expect(result.reasons).toContain("Reflection rejected: missing evidence links.");
  });

  it("should keep low-importance episodes in short-term only", () => {
    const result = policy.evaluate({ kind: "episode", importance: 3 });
    expect(result.shouldWriteLongTerm).toBe(false);
    expect(result.reasons).toContain("Ordinary episode, keeping in short-term only.");
  });
});
