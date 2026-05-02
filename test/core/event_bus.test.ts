import { describe, expect, it, vi } from "vitest";
import { StelleEventBus } from "../../src/utils/event_bus.js";

describe("StelleEventBus payload guard", () => {
  it("rejects oversized payloads and reports dropped items", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bus = new StelleEventBus({ maxPayloadBytes: 16 });

    bus.publish({
      type: "perceptual.event",
      source: "test",
      payload: { text: "this payload is too large for the test bus" },
    });

    expect(bus.getHistory()).toHaveLength(0);
    expect(bus.getBackpressureStatus().droppedItems).toBe(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
