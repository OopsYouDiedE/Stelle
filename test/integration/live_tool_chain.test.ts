import { describe, it, expect, vi } from "vitest";
import { LiveCursor } from "../../src/cursor/live_cursor.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";

describe("Live tool chain integration", () => {
  it("should compose final speech from executed tool results for topic requests", async () => {
    const eventBus = new StelleEventBus();
    const toolExecute = vi.fn().mockImplementation(async (name: string) => {
      if (name === "memory.search") return { ok: true, summary: "tool hit", data: { results: [{ excerpt: "remembered detail" }] } };
      return { ok: true, summary: "ok", data: {} };
    });
    const stageOutput = {
      propose: vi.fn().mockResolvedValue({ status: "accepted", outputId: "out1", reason: "stage_free" }),
      cancelByCursor: vi.fn(),
      snapshot: vi.fn(),
    };
    const generateJson = vi.fn()
      .mockImplementationOnce(async (_prompt, _schema, normalize) => normalize({
        action: "respond_to_specific",
        emotion: "thinking",
        intensity: 3,
        script: "draft without tool",
        reason: "needs memory",
        tool_plan: { calls: [{ tool: "memory.search", parameters: { text: "topic" } }] }
      }))
      .mockImplementationOnce(async (prompt, _schema, normalize) => {
        expect(prompt).toContain("memory.search");
        expect(prompt).toContain("tool hit");
        expect(prompt).toContain("remembered detail");
        return normalize({
          action: "respond_to_specific",
          emotion: "happy",
          intensity: 3,
          script: "final with tool result",
          reason: "tool_composed"
        });
      });

    const cursor = new LiveCursor({
      now: () => 1000,
      config: {
        models: { apiKey: "test-key" },
        live: { ttsEnabled: false, speechQueueLimit: 5 },
      },
      llm: { generateJson, generateText: vi.fn() },
      tools: { execute: toolExecute },
      stageOutput,
      eventBus
    } as any);

    await cursor.receiveTopicRequest({
      type: "live.topic_request",
      source: "discord",
      id: "evt1",
      timestamp: 1000,
      payload: { text: "please discuss the topic", authorId: "u1" }
    } as any);
    await cursor.tick();

    expect(generateJson).toHaveBeenCalledTimes(2);
    expect(stageOutput.propose).toHaveBeenCalledWith(expect.objectContaining({
      cursorId: "live",
      lane: "direct_response",
      text: "final with tool result",
      output: expect.objectContaining({ caption: true, tts: false }),
    }));
  });
});
