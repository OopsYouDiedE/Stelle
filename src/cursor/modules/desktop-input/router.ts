import type { CursorContext } from "../../types.js";
import type { DeviceActionIntent } from "../../../device/action_types.js";
import { DeviceObservationRouter } from "../device_observation_parts.js";
import type { DesktopInputObservation, DesktopInputRouteDecision } from "./types.js";

export class DesktopInputRouter extends DeviceObservationRouter<DesktopInputObservation, DesktopInputRouteDecision> {
  constructor(context: CursorContext, cursorId: string) {
    super(context, cursorId);
  }

  decide(observation: DesktopInputObservation): DesktopInputRouteDecision {
    const intent = this.buildIntent(observation, {
      resourceKind: "desktop_input",
      idPrefix: "desktop-input-action",
      defaultTtlMs: 5_000,
      defaultReason: "Desktop input cursor proposed action from observation.",
    });
    if (!intent) {
      return { reason: "Desktop input observation recorded without requested action." };
    }
    return { intent, reason: "Desktop input action proposed." };
  }

  protected defaultRiskFor(actionKind: DeviceActionIntent["actionKind"]): DeviceActionIntent["risk"] {
    if (actionKind === "type" || actionKind === "android_text") return "text_input";
    if (actionKind === "observe") return "readonly";
    return "safe_interaction";
  }

  protected getObservationMetadata(observation: DesktopInputObservation): Record<string, unknown> {
    return {
      activeWindow: observation.activeWindow,
      screenSummary: observation.screenSummary,
    };
  }
}
