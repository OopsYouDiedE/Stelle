// === Imports ===
import { DeviceObservationResponder } from "../device_observation_parts.js";

// === Responder Implementation ===
export class BrowserResponder extends DeviceObservationResponder {
  constructor() {
    super("Browser action");
  }
}
