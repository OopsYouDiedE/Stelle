import { describe, expect, it, vi } from "vitest";
import { DefaultMemoryWriter } from "../../src/cursor/inner/memory_writer.js";

describe("DefaultMemoryWriter", () => {
  it("persists self state and identity proposals", async () => {
    const memory = {
      writeLongTerm: vi.fn().mockResolvedValue(undefined),
      proposeMemory: vi.fn().mockResolvedValue("prop-1"),
      appendResearchLog: vi.fn().mockResolvedValue("log-1"),
    };
    const writer = new DefaultMemoryWriter(memory as any);

    await writer.writeSelfState("current_focus", "stay curious");
    await writer.proposeIdentityChange({ id: "id-1", change: "protect boundaries", rationale: "consistent pattern", confidence: 0.8 });

    expect(memory.writeLongTerm).toHaveBeenCalledWith("current_focus", "stay curious", "self_state");
    expect(memory.proposeMemory).toHaveBeenCalledWith(expect.objectContaining({
      authorId: "inner",
      source: "inner",
      content: "protect boundaries",
      layer: "core_identity",
    }));
  });

  it("writes research agenda updates as research logs", async () => {
    const memory = {
      writeLongTerm: vi.fn().mockResolvedValue(undefined),
      proposeMemory: vi.fn().mockResolvedValue("prop-1"),
      appendResearchLog: vi.fn().mockResolvedValue("log-1"),
    };
    const writer = new DefaultMemoryWriter(memory as any);

    await writer.writeResearchLog({
      addedTopics: [{ id: "t1", title: "Topic", status: "active" } as any],
      updatedTopics: [],
      closedTopics: [],
    });

    expect(memory.appendResearchLog).toHaveBeenCalledWith(expect.objectContaining({
      focus: "Research agenda update",
      conclusion: expect.stringContaining("+1"),
    }));
  });
});
