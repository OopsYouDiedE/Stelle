import { describe, expect, it } from "vitest";
import { StelleEventBus } from "../../src/utils/event_bus.js";

describe("StelleEventBus backpressure", () => {
  it("coalesces high-frequency events for a slow subscriber", async () => {
    const eventBus = new StelleEventBus();
    const seen: string[] = [];
    let releaseFirst: (() => void) | undefined;

    eventBus.subscribe("live.danmaku.received", async (event) => {
      seen.push(event.id);
      if (event.id === "danmaku-1") {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
    });

    eventBus.publish({ type: "live.danmaku.received", source: "test", id: "danmaku-1", payload: { text: "one" } });
    eventBus.publish({ type: "live.danmaku.received", source: "test", id: "danmaku-2", payload: { text: "two" } });
    eventBus.publish({ type: "live.danmaku.received", source: "test", id: "danmaku-3", payload: { text: "three" } });

    await Promise.resolve();
    expect(seen).toEqual(["danmaku-1"]);

    releaseFirst?.();
    await waitFor(() => seen.length === 2);

    expect(seen).toEqual(["danmaku-1", "danmaku-3"]);
    expect(eventBus.getBackpressureStats()[0]).toMatchObject({
      type: "live.danmaku.received",
      processed: 2,
      coalesced: 1,
    });
  });
});

async function waitFor(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition not met");
}
