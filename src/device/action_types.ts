import { z } from "zod";
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

export const DeviceActionIntentSchema = z.object({
  id: z.string(),
  cursorId: z.string(),
  resourceId: z.string(),
  resourceKind: z.enum(["browser", "desktop_input", "android_device"]),
  actionKind: z.enum([
    "observe",
    "navigate",
    "click",
    "type",
    "hotkey",
    "scroll",
    "android_tap",
    "android_text",
    "android_back",
  ]),
  risk: z.enum(["readonly", "safe_interaction", "text_input", "external_commit", "system"]),
  priority: z.number(),
  createdAt: z.number(),
  ttlMs: z.number().int(),
  requiresApproval: z.boolean().optional(),
  reason: z.string(),
  payload: z.record(z.any()),
  metadata: z.record(z.any()).optional(),
});

export type DeviceActionIntent = z.infer<typeof DeviceActionIntentSchema>;

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

export interface DeviceActionAllowlist {
  cursors?: string[];
  resources?: string[];
  risks?: DeviceActionRisk[];
}

export interface DeviceActionArbiterDeps {
  drivers?: DeviceActionDriver[];
  eventBus?: StelleEventBus;
  now: () => number;
  allowlist?: DeviceActionAllowlist;
}
