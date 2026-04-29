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
        seen.push(events.map(event => event.id));
        if (seen.length === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
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
        seen.push(events.map(event => event.id));
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
    expect(pending.some(batch => batch.some(item => item.id === "urgent"))).toBe(true);
    expect(pending.flat().map(item => item.id)).toEqual(["ordinary-1", "ordinary-2", "urgent", "ordinary-3"]);
  });
});

function fakeContext(): any {
  return {
    config: { live: { ttsEnabled: false } },
    eventBus: new StelleEventBus(),
    now: () => Date.now(),
    tools: {},
    llm: {},
    stageOutput: { propose: vi.fn() },
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
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error("condition not met");
}
