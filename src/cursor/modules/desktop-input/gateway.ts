// === Imports ===
import { DeviceObservationGateway } from "../device_observation_parts.js";
import type { DesktopInputObservation } from "./types.js";

// === Gateway Implementation ===
export class DesktopInputGateway extends DeviceObservationGateway<DesktopInputObservation> {}
