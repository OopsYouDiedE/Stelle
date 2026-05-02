import type { ResourceRef } from "../../../core/protocol/data_ref.js";
import type { PerceptualEvent } from "../../../core/protocol/perceptual_event.js";
import type { DataPlane, EventBus } from "../../../core/protocol/component.js";

export class SceneObservationCapability {
  constructor(
    private dataPlane: DataPlane,
    private eventBus: EventBus,
  ) {}

  async observeFrame(ref: ResourceRef): Promise<void> {
    // 1. Read raw frame from DataPlane
    const rawData = await this.dataPlane.readBlob(ref, "capability.perception.scene_observation");

    // 2. Mock analysis (in reality, this would call a Vision model)
    const summary = "A simple browser page with a login button";

    // 3. Emit structured observation to RuntimeKernel
    const event: PerceptualEvent = {
      id: `obs_${Date.now()}`,
      type: "scene.observation",
      sourceWindow: ref.ownerPackageId,
      sourceCapability: "capability.perception.scene_observation",
      timestamp: Date.now(),
      payload: {
        summary,
        frameRef: ref.id,
        confidence: 0.95,
      },
    };

    this.eventBus.publish({
      type: "perceptual.event",
      source: "capability.perception.scene_observation",
      timestamp: Date.now(),
      payload: event,
    } as any);
  }
}
