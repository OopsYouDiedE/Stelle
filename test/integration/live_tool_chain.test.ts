import { describe, it, expect, vi } from "vitest";
import { LiveCursor } from "../../src/cursor/live/cursor.js";
import { LiveResponder } from "../../src/cursor/live/responder.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";

describe("Live tool chain integration", () => {
  it("returns StageOutputArbiter decisions with group and sequence metadata", async () => {
    const stageOutput = {
      propose: vi.fn().mockImplementation(async (intent) => ({
        status: intent.sequence === 1 ? "dropped" : "queued",
        outputId: intent.id,
        reason: intent.sequence === 1 ? "queue_overflow" : "stage_busy",
        intent,
      })),
    };
    const responder = new LiveResponder({
      config: { live: { ttsEnabled: false } },
      stageOutput,
    } as any);

    const decisions = await responder.enqueue("response", "第一句。第二句。", "neutral", { groupId: "group-1", sequenceStart: 0 });

    expect(decisions.map(d => d.status)).toEqual(["queued", "dropped"]);
    expect(stageOutput.propose).toHaveBeenNthCalledWith(1, expect.objectContaining({ groupId: "group-1", sequence: 0 }));
    expect(stageOutput.propose).toHaveBeenNthCalledWith(2, expect.objectContaining({ groupId: "group-1", sequence: 1 }));
  });

  it("maps semantic live emotions to model expression names", async () => {
    const stageOutput = {
      propose: vi.fn().mockImplementation(async (intent) => ({ status: "accepted", outputId: intent.id, reason: "ok", intent })),
    };
    const responder = new LiveResponder({
      config: { live: { ttsEnabled: false } },
      stageOutput,
    } as any);

    await responder.enqueue("response", "好呀。", "happy", { groupId: "group-1" });

    expect(stageOutput.propose).toHaveBeenCalledWith(expect.objectContaining({
      output: expect.objectContaining({
        expression: "exp_01",
      }),
    }));
  });

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
      cursorId: "live_danmaku",
      lane: "direct_response",
      text: "final with tool result",
      output: expect.objectContaining({ caption: true, tts: false }),
    }));
  });
});
