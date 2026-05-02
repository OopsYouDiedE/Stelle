// === Imports ===
import { DeviceObservationGateway } from "../device_observation_parts.js";
import type { BrowserObservation } from "./types.js";

// === Gateway Implementation ===
export class BrowserGateway extends DeviceObservationGateway<BrowserObservation> {}
