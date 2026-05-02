// === Imports ===
import { DeviceObservationResponder } from "../device_observation_parts.js";

// === Responder Implementation ===
export class DesktopInputResponder extends DeviceObservationResponder {
  constructor() {
    super("Desktop input action");
  }
}
