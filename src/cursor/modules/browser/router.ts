import type { CursorContext } from "../../types.js";
import type { DeviceActionIntent } from "../../../device/action_types.js";
import { DeviceObservationRouter } from "../device_observation_parts.js";
import type { BrowserObservation, BrowserRouteDecision } from "./types.js";

export class BrowserRouter extends DeviceObservationRouter<BrowserObservation, BrowserRouteDecision> {
  constructor(context: CursorContext, cursorId: string) {
    super(context, cursorId);
  }

  decide(observation: BrowserObservation): BrowserRouteDecision {
    const intent = this.buildIntent(observation, {
      resourceKind: "browser",
      idPrefix: "browser-action",
      defaultTtlMs: 10_000,
      defaultReason: "Browser cursor proposed action from observation.",
    });
    if (!intent) {
      return { reason: "Observation recorded without requested action." };
    }
    return { intent, reason: "Device action proposed." };
  }

  protected defaultRiskFor(actionKind: DeviceActionIntent["actionKind"]): DeviceActionIntent["risk"] {
    if (actionKind === "type") return "text_input";
    if (actionKind === "observe") return "readonly";
    return "safe_interaction";
  }

  protected getObservationMetadata(observation: BrowserObservation): Record<string, unknown> {
    return {
      url: observation.url,
      title: observation.title,
    };
  }
}
