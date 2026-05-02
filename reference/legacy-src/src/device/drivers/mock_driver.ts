import type {
  DeviceActionDriver,
  DeviceActionIntent,
  DeviceActionResult,
  DeviceResourceKind,
} from "../action_types.js";

export class MockDeviceActionDriver implements DeviceActionDriver {
  constructor(public readonly resourceKind: DeviceResourceKind = "browser") {}

  async execute(intent: DeviceActionIntent): Promise<DeviceActionResult> {
    return {
      ok: true,
      summary: `Mock ${intent.resourceKind}.${intent.actionKind} executed for ${intent.resourceId}.`,
      observation: {
        resourceId: intent.resourceId,
        resourceKind: intent.resourceKind,
        actionKind: intent.actionKind,
        payload: intent.payload,
      },
    };
  }
}
