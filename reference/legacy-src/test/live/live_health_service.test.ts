import { describe, expect, it } from "vitest";
import { LiveHealthService } from "../../src/live/controller/health_service.js";
import { StageOutputArbiter } from "../../src/actuator/output_arbiter.js";
import type { StageOutputRenderer } from "../../src/stage/output_types.js";
import { LiveRuntime } from "../../src/utils/live.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";

describe("LiveHealthService", () => {
  it("aggregates ingress, TTS, moderation, stage, and OBS health", async () => {
    const eventBus = new StelleEventBus();
    const renderer: StageOutputRenderer = { render: async () => undefined, stopCurrentOutput: async () => undefined };
    const stageOutput = new StageOutputArbiter({ renderer, now: () => 10, eventBus });
    const live = new LiveRuntime(undefined as any, undefined, eventBus);
    const health = new LiveHealthService({ sessionId: "s1", eventBus, stageOutput, live });
    health.start();

    eventBus.publish({
      type: "live.event.received",
      source: "system",
      id: "e1",
      timestamp: 20,
      payload: { receivedAt: 10 },
    });
    eventBus.publish({
      type: "live.ingress.dropped",
      source: "system",
      id: "d1",
      timestamp: 21,
      payload: { reason: "duplicate" },
    });
    eventBus.publish({
      type: "live.tts.error",
      source: "system",
      id: "t1",
      timestamp: 22,
      payload: { error: "timeout" },
    } as any);
    eventBus.publish({
      type: "live.moderation.decision",
      source: "system",
      id: "m1",
      timestamp: 23,
      payload: { action: "drop" },
    } as any);

    await new Promise((resolve) => setTimeout(resolve, 0));
    const snapshot = await health.snapshot();
    health.stop();

    expect(snapshot.sessionId).toBe("s1");
    expect(snapshot.ingress.received).toBe(1);
    expect(snapshot.ingress.duplicates).toBe(1);
    expect(snapshot.tts.failures).toBe(1);
    expect(snapshot.moderation.dropped).toBe(1);
    expect(snapshot.stageOutput.id).toBe("stage_output");
  });
});
