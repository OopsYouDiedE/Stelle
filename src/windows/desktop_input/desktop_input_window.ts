import type { ComponentRegistry } from "../../core/protocol/component.js";
import type { DataPlane } from "../../core/runtime/data_plane.js";
import type { ResourceRef } from "../../core/protocol/data_ref.js";
import type { DeviceActionArbiter } from "../../capabilities/action/device_action/arbiter.js";

export class DesktopInputWindow {
  constructor(
    private readonly registry: ComponentRegistry,
    private readonly dataPlane: DataPlane,
  ) {}

  async publishState(state: object, metadata: Record<string, unknown> = {}): Promise<ResourceRef> {
    return this.dataPlane.putBlob({
      ownerPackageId: "window.desktop_input",
      kind: "scene_snapshot",
      mediaType: "application/json",
      data: state,
      ttlMs: 10_000,
      accessScope: "runtime",
      metadata,
    });
  }

  async proposeAction(input: unknown) {
    return this.registry.resolve<DeviceActionArbiter>("action.device_action")?.propose(input);
  }

  snapshot() {
    return { id: "window.desktop_input", active: true };
  }
}
