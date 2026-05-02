import { describe, expect, it, vi } from "vitest";
import { LiveGateway } from "../../src/cursor/live/gateway.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";
import type { NormalizedLiveEvent } from "../../src/utils/live_event.js";

describe("LiveGateway ingress decisions", () => {
  it("filters numeric and check-in noise without flushing it to the router", async () => {
    const flushed: NormalizedLiveEvent[][] = [];
    const gateway = new LiveGateway(fakeContext(), immediatePolicy());

    const result = await gateway.receive(
      { id: "noise-1", source: "fixture", cmd: "DANMU_MSG", text: "666666" },
      (batch) => flushed.push(batch),
    );

    expect(result).toEqual({ accepted: true, reason: "noise_filtered" });
    expect(flushed).toHaveLength(0);
  });

  it("routes gift events to engagement handling instead of danmaku response planning", async () => {
    const flushed: NormalizedLiveEvent[][] = [];
    const gateway = new LiveGateway(fakeContext(), immediatePolicy());

    const result = await gateway.receive({ id: "gift-1", source: "fixture", cmd: "SEND_GIFT", text: "辣条" }, (batch) =>
      flushed.push(batch),
    );

    expect(result).toEqual({ accepted: true, reason: "engagement_event" });
    expect(flushed).toHaveLength(0);
  });

  it("flushes a real viewer question for live response planning", async () => {
    const flushed: NormalizedLiveEvent[][] = [];
    const gateway = new LiveGateway(fakeContext(), immediatePolicy());

    const result = await gateway.receive(
      { id: "q-1", source: "fixture", cmd: "DANMU_MSG", text: "能看到我的弹幕吗？", userName: "小星" },
      (batch) => flushed.push(batch),
    );

    expect(result).toEqual({ accepted: true, reason: "buffered" });
    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.[0]).toMatchObject({
      id: "q-1",
      kind: "danmaku",
      text: "能看到我的弹幕吗？",
      user: { name: "小星" },
    });
  });
});

function fakeContext(): any {
  return {
    eventBus: new StelleEventBus(),
    now: vi.fn(() => 1000),
  };
}

function immediatePolicy() {
  return {
    flushIntervalMs: 1_000,
    maxWaitMs: 1_000,
    urgentDelayMs: 0,
    maxBatchSize: 1,
    maxBufferSize: 10,
  };
}
