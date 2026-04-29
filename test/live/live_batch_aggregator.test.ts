import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveBatchAggregator, type DropReason, type FlushReason } from "../../src/live/ingress/live_batch_aggregator.js";
import type { NormalizedLiveEvent } from "../../src/utils/live_event.js";

describe("LiveBatchAggregator", () => {
  let now = 0;
  const policy = {
    flushIntervalMs: 2_000,
    maxWaitMs: 2_000,
    urgentDelayMs: 100,
    maxBatchSize: 20,
    maxBufferSize: 200,
  };

  beforeEach(() => {
    now = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes continuous ordinary messages by max wait instead of resetting the timer", () => {
    const flushed: Array<{ batch: NormalizedLiveEvent[]; reason: FlushReason; at: number }> = [];
    const aggregator = new LiveBatchAggregator(
      policy,
      () => now,
      (batch, reason) => flushed.push({ batch, reason, at: now }),
      () => undefined,
    );

    for (let i = 0; i < 60; i += 1) {
      aggregator.push(event(`ordinary-${i}`, now));
      now += 100;
      vi.advanceTimersByTime(100);
    }

    expect(flushed.length).toBeGreaterThanOrEqual(2);
    expect(flushed[0].at).toBeLessThanOrEqual(2_000);
    expect(flushed[0].batch.length).toBeGreaterThan(1);
  });

  it("flushes a high priority event quickly", () => {
    const flushed: Array<{ batch: NormalizedLiveEvent[]; reason: FlushReason; at: number }> = [];
    const aggregator = new LiveBatchAggregator(
      policy,
      () => now,
      (batch, reason) => flushed.push({ batch, reason, at: now }),
      () => undefined,
    );

    aggregator.push(event("superchat-1", now, "super_chat", "high"));
    now += 99;
    vi.advanceTimersByTime(99);
    expect(flushed).toHaveLength(0);

    now += 1;
    vi.advanceTimersByTime(1);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toMatchObject({ reason: "urgent", at: 100 });
  });

  it("flushes immediately at max batch size", () => {
    const flushed: NormalizedLiveEvent[][] = [];
    const aggregator = new LiveBatchAggregator(
      { ...policy, maxBatchSize: 3 },
      () => now,
      (batch) => flushed.push(batch),
      () => undefined,
    );

    aggregator.push(event("a", now));
    aggregator.push(event("b", now));
    expect(flushed).toHaveLength(0);
    aggregator.push(event("c", now));

    expect(flushed).toHaveLength(1);
    expect(flushed[0].map(item => item.id)).toEqual(["a", "b", "c"]);
  });

  it("drops the lowest priority event with an explicit reason when the buffer is full", () => {
    const dropped: Array<{ event: NormalizedLiveEvent; reason: DropReason }> = [];
    const aggregator = new LiveBatchAggregator(
      { ...policy, maxBatchSize: 10, maxBufferSize: 2 },
      () => now,
      () => undefined,
      (event, reason) => dropped.push({ event, reason }),
    );

    aggregator.push(event("low-old", 1, "danmaku", "low"));
    aggregator.push(event("medium", 2, "danmaku", "medium"));
    aggregator.push(event("gift", 3, "gift", "medium"));

    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ reason: "buffer_overflow", event: { id: "low-old" } });
    expect(aggregator.getBufferSize()).toBe(2);
  });
});

function event(
  id: string,
  receivedAt: number,
  kind: NormalizedLiveEvent["kind"] = "danmaku",
  priority: NormalizedLiveEvent["priority"] = "low",
): NormalizedLiveEvent {
  return {
    id,
    source: "fixture",
    kind,
    priority,
    receivedAt,
    text: id,
  };
}
