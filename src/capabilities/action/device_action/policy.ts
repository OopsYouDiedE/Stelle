import type { DeviceActionAllowlist, DeviceActionIntent, DeviceActionKind, DeviceActionRisk } from "./types.js";

export interface DeviceActionPolicyDecision {
  allowed: boolean;
  reason: string;
}

const RISK_LEVELS: DeviceActionRisk[] = ["readonly", "safe_interaction", "text_input", "external_commit", "system"];

const KIND_RISK_MAP: Record<DeviceActionKind, DeviceActionRisk[]> = {
  observe: ["readonly"],
  navigate: ["safe_interaction"],
  move_mouse: ["safe_interaction"],
  click: ["safe_interaction"],
  mouse_down: ["safe_interaction"],
  mouse_up: ["safe_interaction"],
  drag: ["safe_interaction"],
  scroll: ["safe_interaction"],
  type: ["text_input"],
  hotkey: ["safe_interaction", "system"],
  key_down: ["safe_interaction"],
  key_up: ["safe_interaction"],
  android_tap: ["safe_interaction"],
  android_text: ["text_input"],
  android_back: ["safe_interaction"],
};

const RESOURCE_ACTIONS: Record<string, DeviceActionKind[]> = {
  browser: ["observe", "navigate", "click", "type", "hotkey", "scroll"],
  desktop_input: [
    "observe",
    "move_mouse",
    "click",
    "mouse_down",
    "mouse_up",
    "drag",
    "type",
    "hotkey",
    "key_down",
    "key_up",
    "scroll",
  ],
  android_device: ["observe", "android_tap", "android_text", "android_back"],
};

export function validateDeviceActionPolicy(
  intent: DeviceActionIntent,
  allowlist: DeviceActionAllowlist | undefined,
): DeviceActionPolicyDecision {
  const resourceDecision = validateResourceAction(intent);
  if (!resourceDecision.allowed) return resourceDecision;

  const riskDecision = validateRisk(intent);
  if (!riskDecision.allowed) return riskDecision;

  const allowlistDecision = validateAllowlist(intent, allowlist);
  if (!allowlistDecision.allowed) return allowlistDecision;

  return validatePayload(intent);
}

function validateResourceAction(intent: DeviceActionIntent): DeviceActionPolicyDecision {
  const allowedActions = RESOURCE_ACTIONS[intent.resourceKind] ?? [];
  if (!allowedActions.includes(intent.actionKind)) {
    return {
      allowed: false,
      reason: `Action ${intent.actionKind} is not supported for resource kind ${intent.resourceKind}.`,
    };
  }

  return { allowed: true, reason: "Resource action accepted." };
}

function validateRisk(intent: DeviceActionIntent): DeviceActionPolicyDecision {
  const allowedRisks = KIND_RISK_MAP[intent.actionKind];
  const minRequiredRisk = allowedRisks[0];
  const intentRiskIndex = RISK_LEVELS.indexOf(intent.risk);
  const minRiskIndex = RISK_LEVELS.indexOf(minRequiredRisk);

  if (intentRiskIndex < minRiskIndex) {
    return {
      allowed: false,
      reason: `Risk level too low: ${intent.actionKind} requires at least ${minRequiredRisk}, but intent has ${intent.risk}.`,
    };
  }

  if (intent.requiresApproval) {
    return { allowed: false, reason: "Action requires explicit approval." };
  }
  if (intent.risk === "system" || intent.risk === "external_commit") {
    return { allowed: false, reason: "High-risk action requires explicit approval." };
  }

  if (!allowedRisks.includes(intent.risk)) {
    return {
      allowed: false,
      reason: `Risk level mismatch: ${intent.actionKind} allows ${allowedRisks.join(" or ")}, but intent has ${intent.risk}.`,
    };
  }

  return { allowed: true, reason: "Risk accepted." };
}

function validateAllowlist(
  intent: DeviceActionIntent,
  allowlist: DeviceActionAllowlist | undefined,
): DeviceActionPolicyDecision {
  if (!allowlist) {
    return {
      allowed: false,
      reason: "DeviceActionArbiter has no allowlist configured. Defaulting to deny all.",
    };
  }

  if (allowlist.cursors && !allowlist.cursors.includes(intent.cursorId)) {
    return { allowed: false, reason: `Cursor ${intent.cursorId} is not in the allowlist.` };
  }
  if (allowlist.resources && !allowlist.resources.includes(intent.resourceId)) {
    return { allowed: false, reason: `Resource ${intent.resourceId} is not in the allowlist.` };
  }
  if (allowlist.resourceKinds && !allowlist.resourceKinds.includes(intent.resourceKind)) {
    return { allowed: false, reason: `Resource kind ${intent.resourceKind} is not in the allowlist.` };
  }
  if (allowlist.risks && !allowlist.risks.includes(intent.risk)) {
    return { allowed: false, reason: `Risk ${intent.risk} is not in the allowlist.` };
  }

  return { allowed: true, reason: "Allowlist accepted." };
}

function validatePayload(intent: DeviceActionIntent): DeviceActionPolicyDecision {
  const payload = intent.payload ?? {};
  const hasNumber = (key: string) => typeof payload[key] === "number" && Number.isFinite(payload[key]);
  const hasString = (key: string) => typeof payload[key] === "string" && String(payload[key]).trim().length > 0;
  const hasPoint = (key: string) => {
    const value = payload[key];
    return (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as Record<string, unknown>).x === "number" &&
      typeof (value as Record<string, unknown>).y === "number"
    );
  };

  if (intent.actionKind === "observe" || intent.actionKind === "android_back") {
    return { allowed: true, reason: "Payload accepted." };
  }
  if (intent.actionKind === "navigate") {
    if (!hasString("url")) return { allowed: false, reason: "navigate requires payload.url." };
    try {
      const url = new URL(String(payload.url));
      if (!["http:", "https:", "about:"].includes(url.protocol)) {
        return { allowed: false, reason: `navigate URL protocol is not allowed: ${url.protocol}` };
      }
    } catch {
      return { allowed: false, reason: "navigate payload.url must be a valid URL." };
    }
  }
  if (intent.actionKind === "move_mouse" && !(hasNumber("x") && hasNumber("y"))) {
    return { allowed: false, reason: "move_mouse requires numeric payload.x and payload.y." };
  }
  if (["click", "mouse_down", "mouse_up", "android_tap"].includes(intent.actionKind)) {
    const hasCoordinates = hasNumber("x") && hasNumber("y");
    const hasSelector = intent.resourceKind === "browser" && hasString("selector");
    if (!hasCoordinates && !hasSelector) {
      return { allowed: false, reason: `${intent.actionKind} requires coordinates or a browser selector.` };
    }
  }
  if (intent.actionKind === "drag") {
    const hasFlat = hasNumber("fromX") && hasNumber("fromY") && hasNumber("toX") && hasNumber("toY");
    if (!hasFlat && !(hasPoint("from") && hasPoint("to"))) {
      return { allowed: false, reason: "drag requires from/to points or flat fromX/fromY/toX/toY coordinates." };
    }
  }
  if (["type", "android_text"].includes(intent.actionKind) && !hasString("text")) {
    return { allowed: false, reason: `${intent.actionKind} requires payload.text.` };
  }
  if (intent.actionKind === "hotkey") {
    const keys = payload.keys;
    if (
      !hasString("key") &&
      !(Array.isArray(keys) && keys.every((key) => typeof key === "string" && key.trim().length > 0))
    ) {
      return { allowed: false, reason: "hotkey requires payload.key or payload.keys." };
    }
  }
  if (["key_down", "key_up"].includes(intent.actionKind) && !hasString("key")) {
    return { allowed: false, reason: `${intent.actionKind} requires payload.key.` };
  }
  if (intent.actionKind === "scroll" && !(hasNumber("deltaX") || hasNumber("deltaY") || hasNumber("amount"))) {
    return { allowed: false, reason: "scroll requires numeric payload.deltaX, payload.deltaY, or payload.amount." };
  }
  return { allowed: true, reason: "Payload accepted." };
}
