import type { StelleEventBus } from "../utils/event_bus.js";

export type DeviceResourceKind = "browser" | "desktop_input" | "android_device";

export type DeviceActionKind =
  | "observe"
  | "navigate"
  | "click"
  | "type"
  | "hotkey"
  | "scroll"
  | "android_tap"
  | "android_text"
  | "android_back";

export type DeviceActionRisk = "readonly" | "safe_interaction" | "text_input" | "external_commit" | "system";

export interface DeviceActionIntent {
  id: string;
  cursorId: string;
  resourceId: string;
  resourceKind: DeviceResourceKind;
  actionKind: DeviceActionKind;
  risk: DeviceActionRisk;
  priority: number;
  ttlMs: number;
  requiresApproval?: boolean;
  reason: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface DeviceActionResult {
  ok: boolean;
  summary: string;
  observation?: Record<string, unknown>;
}

export type DeviceActionDecisionStatus = "accepted" | "rejected" | "completed" | "failed";

export interface DeviceActionDecision {
  status: DeviceActionDecisionStatus;
  reason: string;
  intent: DeviceActionIntent;
  result?: DeviceActionResult;
}

export interface DeviceActionDriver {
  readonly resourceKind: DeviceResourceKind;
  execute(intent: DeviceActionIntent): Promise<DeviceActionResult>;
}

export interface DeviceActionArbiterDeps {
  drivers?: DeviceActionDriver[];
  eventBus?: StelleEventBus;
  now: () => number;
}
