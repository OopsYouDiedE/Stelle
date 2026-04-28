import type { DeviceActionDriver, DeviceActionIntent, DeviceActionResult, DeviceResourceKind } from "./action_types.js";

export class DeviceActionRenderer {
  private readonly drivers = new Map<DeviceResourceKind, DeviceActionDriver>();

  constructor(drivers: DeviceActionDriver[] = []) {
    for (const driver of drivers) {
      this.drivers.set(driver.resourceKind, driver);
    }
  }

  async render(intent: DeviceActionIntent): Promise<DeviceActionResult> {
    const driver = this.drivers.get(intent.resourceKind);
    if (!driver) {
      return {
        ok: false,
        summary: `No device driver registered for ${intent.resourceKind}.`,
      };
    }
    return driver.execute(intent);
  }
}
