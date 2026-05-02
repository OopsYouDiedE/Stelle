import type { DataPlane } from "../../core/runtime/data_plane.js";
import type { ResourceRef } from "../../core/protocol/data_ref.js";
import type { ComponentRegistry } from "../../core/protocol/component.js";
import type { DeviceActionService } from "../../capabilities/action/device_action/types.js";

export class BrowserWindow {
  constructor(
    private readonly registry: ComponentRegistry,
    private readonly dataPlane: DataPlane,
  ) {}

  async publishSnapshot(snapshot: object, metadata: Record<string, unknown> = {}): Promise<ResourceRef> {
    return this.dataPlane.putBlob({
      ownerPackageId: "window.browser",
      kind: "browser_snapshot",
      mediaType: "application/json",
      data: snapshot,
      ttlMs: 30_000,
      accessScope: "runtime",
      metadata,
    });
  }

  async proposeAction(input: unknown) {
    return this.registry.resolve<DeviceActionService>("action.device_action")?.propose(input);
  }

  snapshot() {
    return { id: "window.browser", active: true };
  }
}
