// === Imports ===
import type { DeviceActionIntent } from "../../../device/action_types.js";

// === Types ===
export interface BrowserObservation {
  resourceId: string;
  url?: string;
  title?: string;
  summary?: string;
  requestedAction?: Partial<DeviceActionIntent>;
  raw?: Record<string, unknown>;
}

export interface BrowserRouteDecision {
  intent?: DeviceActionIntent;
  reason: string;
}
