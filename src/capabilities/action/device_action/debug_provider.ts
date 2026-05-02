import type { DebugProvider } from "../../../core/protocol/debug.js";
import type { DeviceActionArbiter } from "./arbiter.js";

export function createDeviceActionDebugProvider(arbiter: DeviceActionArbiter): DebugProvider {
  return {
    id: "action.device_action.debug",
    title: "Device Action",
    ownerPackageId: "capability.action.device_action",
    panels: [
      {
        id: "snapshot",
        title: "Arbiter Status",
        kind: "json",
        getData: () => arbiter.snapshot(),
      },
    ],
    getSnapshot: () => arbiter.snapshot(),
  };
}
