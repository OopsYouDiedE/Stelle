import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LivePlatformSupervisor } from "../../src/windows/live/adapters/supervisor.js";
import type { LivePlatformBridge, LivePlatformStatus } from "../../src/windows/live/adapters/types.js";
import { StelleEventBus } from "../../src/core/event/event_bus.js";

describe("LivePlatformSupervisor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries bridge start failures with backoff", async () => {
    const eventBus = new StelleEventBus();
    const bridge = fakeBridge();
    bridge.start = vi
      .fn()
      .mockRejectedValueOnce(new Error("first fail"))
      .mockImplementationOnce(async () => {
        bridge.setConnected(true);
      });

    const supervisor = new LivePlatformSupervisor(bridge, eventBus, quietLogger(), {
      initialBackoffMs: 10,
      maxBackoffMs: 10,
      jitterMs: 0,
      pollIntervalMs: 10,
    });

    supervisor.start();
    await flushPromises();
    expect(bridge.start).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);
    await flushPromises();

    expect(bridge.start).toHaveBeenCalledTimes(2);
    expect(eventBus.getHistory().map((event) => event.type)).toContain("live.platform.error");
    await supervisor.stop();
  });

  it("reconnects after a connected bridge becomes disconnected", async () => {
    const bridge = fakeBridge();
    bridge.start = vi.fn(async () => {
      bridge.setConnected(true);
    });
    const supervisor = new LivePlatformSupervisor(bridge, new StelleEventBus(), quietLogger(), {
      initialBackoffMs: 10,
      maxBackoffMs: 10,
      jitterMs: 0,
      pollIntervalMs: 10,
    });

    supervisor.start();
    await flushPromises();
    expect(bridge.start).toHaveBeenCalledTimes(1);

    bridge.setConnected(false);
    await vi.advanceTimersByTimeAsync(20);
    await flushPromises();

    expect(bridge.start).toHaveBeenCalledTimes(2);
    await supervisor.stop();
  });

  it("does not reconnect after stop", async () => {
    const bridge = fakeBridge();
    bridge.start = vi.fn(async () => {
      bridge.setConnected(true);
    });
    const supervisor = new LivePlatformSupervisor(bridge, new StelleEventBus(), quietLogger(), {
      initialBackoffMs: 10,
      maxBackoffMs: 10,
      jitterMs: 0,
      pollIntervalMs: 10,
    });

    supervisor.start();
    await flushPromises();
    await supervisor.stop();
    bridge.setConnected(false);

    await vi.advanceTimersByTimeAsync(50);
    await flushPromises();

    expect(bridge.start).toHaveBeenCalledTimes(1);
  });
});

function fakeBridge(): LivePlatformBridge & { setConnected(value: boolean): void } {
  let connected = false;
  const status = (): LivePlatformStatus => ({
    platform: "twitch",
    enabled: true,
    connected,
    received: 0,
  });
  return {
    platform: "twitch",
    start: vi.fn(async () => {
      connected = true;
    }),
    stop: vi.fn(async () => {
      connected = false;
    }),
    status,
    setConnected(value: boolean) {
      connected = value;
    },
  };
}

function quietLogger(): any {
  return { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
