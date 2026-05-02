import { describe, expect, it, vi } from "vitest";
import { DataPlane } from "../../src/core/runtime/data_plane.js";
import { StelleEventBus } from "../../src/core/event/event_bus.js";
import { SceneObservationCapability } from "../../src/capabilities/perception/scene_observation/observer.js";
import { RuntimeKernel } from "../../src/capabilities/cognition/runtime_kernel/kernel.js";

describe("DataPlane Bypass Flow Integration", () => {
  it("should handle multi-modal flow using ResourceRef bypass", async () => {
    const dataPlane = new DataPlane();
    const eventBus = new StelleEventBus();
    const observer = new SceneObservationCapability(dataPlane, eventBus);

    // 1. Mock Kernel to track received observations
    const mockPipeline = {
      enrich: async (e: any) => e,
      evaluateAttention: async () => ({ accepted: true, reason: "salient", salience: 1.0 }),
      plan: async () => [],
    };
    const kernel = new RuntimeKernel(mockPipeline);
    const kernelStepSpy = vi.spyOn(kernel, "step");

    // Connect Kernel to EventBus (mocking real orchestration)
    eventBus.subscribe("perceptual.event" as any, async (event: any) => {
      await kernel.step(event.payload);
    });

    // 2. Simulate Window pushing a heavy frame to DataPlane
    const frameData = new Uint8Array([0, 1, 2, 3]);
    const frameRef = await dataPlane.putBlob({
      ownerPackageId: "window.browser",
      kind: "image",
      mediaType: "image/png",
      data: frameData,
      ttlMs: 5000,
      accessScope: "public",
    });

    // 3. Window notifies SceneObservation via EventBus (carrying only the Ref)
    await observer.observeFrame(frameRef);

    // 4. Verify SceneObservation processed the frame and Kernel received summary
    expect(kernelStepSpy).toHaveBeenCalled();
    const kernelReceivedEvent = kernelStepSpy.mock.calls[0][0];

    expect(kernelReceivedEvent.type).toBe("scene.observation");
    expect(kernelReceivedEvent.payload.summary).toContain("login button");
    expect(kernelReceivedEvent.payload.frameRef).toBe(frameRef.id);
  });
});
