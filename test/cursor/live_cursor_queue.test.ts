import { describe, expect, it, vi } from "vitest";
import { LiveDanmakuCursor } from "../../src/cursor/live/cursor.js";
import type { NormalizedLiveEvent } from "../../src/utils/live_event.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";

describe("LiveDanmakuCursor pending batch queue", () => {
  it("enqueues batches while draining instead of dropping them", async () => {
    const cursor = new LiveDanmakuCursor(fakeContext());
    let releaseFirst: (() => void) | undefined;
    const seen: string[][] = [];

    (cursor as any).router = {
      decide: vi.fn(async (events: NormalizedLiveEvent[]) => {
        seen.push(events.map((event) => event.id));
        if (seen.length === 1)
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        return { action: "drop_noise", reason: "test", script: "", emotion: "neutral" };
      }),
      compose: vi.fn(),
    };
    (cursor as any).executor = { execute: vi.fn() };
    (cursor as any).responder = {
      getRecentSpeech: () => [],
      enqueue: vi.fn(),
      getQueueStats: () => ({ topic: 0, response: 0 }),
    };

    const draining = (cursor as any).processBatch([event("batch-1")]);
    await Promise.resolve();
    void (cursor as any).processBatch([event("batch-2")]);
    void (cursor as any).processBatch([event("batch-3")]);

    expect(seen).toEqual([["batch-1"]]);

    releaseFirst?.();
    await draining;

    expect(seen).toEqual([["batch-1"], ["batch-2", "batch-3"]]);
  });

  it("continues draining after a failed batch", async () => {
    const cursor = new LiveDanmakuCursor(fakeContext());
    const seen: string[][] = [];

    (cursor as any).router = {
      decide: vi.fn(async (events: NormalizedLiveEvent[]) => {
        seen.push(events.map((event) => event.id));
        if (seen.length === 1) throw new Error("boom");
        return { action: "drop_noise", reason: "test", script: "", emotion: "neutral" };
      }),
      compose: vi.fn(),
    };
    (cursor as any).executor = { execute: vi.fn() };
    (cursor as any).responder = {
      getRecentSpeech: () => [],
      enqueue: vi.fn(),
      getQueueStats: () => ({ topic: 0, response: 0 }),
    };

    await (cursor as any).processBatch([event("bad")]);
    await (cursor as any).processBatch([event("good")]);
    await waitFor(() => seen.length === 2);

    expect(seen).toEqual([["bad"], ["good"]]);
  });

  it("coalesces ordinary overflow while preserving urgent batches", () => {
    const cursor = new LiveDanmakuCursor(fakeContext());
    (cursor as any).maxPendingBatches = 2;
    (cursor as any).maxEventsPerMergedBatch = 3;

    (cursor as any).enqueueBatch([event("ordinary-1")]);
    (cursor as any).enqueueBatch([event("ordinary-2")]);
    (cursor as any).enqueueBatch([event("urgent", "gift", "medium")]);
    (cursor as any).enqueueBatch([event("ordinary-3")]);

    const pending = (cursor as any).pendingBatches as NormalizedLiveEvent[][];
    expect(pending.some((batch) => batch.some((item) => item.id === "urgent"))).toBe(true);
    expect(pending.flat().map((item) => item.id)).toEqual(["ordinary-1", "ordinary-2", "urgent", "ordinary-3"]);
  });

  it("reports stage queue state from StageOutputArbiter snapshot", () => {
    const cursor = new LiveDanmakuCursor(
      fakeContext({
        stageOutput: {
          propose: vi.fn(),
          snapshot: () => ({
            status: "queued",
            queueLength: 2,
            currentOutputId: "out-1",
            currentLane: "direct_response",
          }),
        },
      }),
    );

    expect(cursor.snapshot().state).toMatchObject({
      stageStatus: "queued",
      stageQueueLength: 2,
      stageCurrentOutputId: "out-1",
      stageCurrentLane: "direct_response",
    });
  });

  it("routes addressable danmaku responses through StageOutput as direct_response", async () => {
    const eventBus = new StelleEventBus();
    const generateJson = vi.fn().mockImplementation(async (_prompt, _schema, normalize) =>
      normalize({
        action: "respond_to_specific",
        emotion: "happy",
        intensity: 3,
        script: "小星，能看到，你这条弹幕进来了。",
        reason: "viewer question",
      }),
    );
    const stageOutput = {
      propose: vi
        .fn()
        .mockImplementation(async (intent) => ({ status: "accepted", outputId: intent.id, reason: "ok", intent })),
      snapshot: () => ({ status: "idle", queueLength: 0 }),
    };
    const cursor = new LiveDanmakuCursor(
      fakeContext({
        eventBus,
        llm: { generateJson, generateText: vi.fn() },
        stageOutput,
      }),
    );

    await (cursor as any).processBatch([
      {
        ...event("q-1"),
        text: "能看到我的弹幕吗？",
        user: { id: "u1", name: "小星" },
      },
    ]);

    expect(stageOutput.propose).toHaveBeenCalledWith(
      expect.objectContaining({
        cursorId: "live_danmaku",
        lane: "direct_response",
        priority: 60,
        text: "小星，能看到，你这条弹幕进来了。",
        output: expect.objectContaining({ caption: true, tts: false }),
      }),
    );
    expect(eventBus.getHistory().some((event) => event.type === "live.route.decision")).toBe(true);
  });
});

function fakeContext(overrides: Record<string, unknown> = {}): any {
  return {
    config: { live: { ttsEnabled: false } },
    eventBus: new StelleEventBus(),
    now: () => Date.now(),
    tools: {},
    llm: {},
    stageOutput: {
      propose: vi.fn(),
      snapshot: () => ({ status: "idle", queueLength: 0 }),
    },
    ...overrides,
  };
}

function event(
  id: string,
  kind: NormalizedLiveEvent["kind"] = "danmaku",
  priority: NormalizedLiveEvent["priority"] = "low",
): NormalizedLiveEvent {
  return {
    id,
    source: "fixture",
    kind,
    priority,
    receivedAt: Date.now(),
    text: id,
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition not met");
}
