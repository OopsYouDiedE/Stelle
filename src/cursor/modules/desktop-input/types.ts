// === Imports ===
import type { DeviceActionIntent } from "../../../device/action_types.js";

// === Types ===
export interface DesktopInputObservation {
  resourceId: string;
  activeWindow?: string;
  screenSummary?: string;
  requestedAction?: Partial<DeviceActionIntent>;
  raw?: Record<string, unknown>;
}

export interface DesktopInputRouteDecision {
  intent?: DeviceActionIntent;
  reason: string;
}
