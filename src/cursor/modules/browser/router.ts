import type { CursorContext } from "../../types.js";
import type { DeviceActionIntent } from "../../../device/action_types.js";
import type { BrowserObservation, BrowserRouteDecision } from "./types.js";

export class BrowserRouter {
  constructor(private readonly context: CursorContext, private readonly cursorId: string) {}

  decide(observation: BrowserObservation): BrowserRouteDecision {
    const requested = observation.requestedAction;
    if (!requested?.actionKind) {
      return { reason: "Observation recorded without requested action." };
    }

    const intent: DeviceActionIntent = {
      id: String(requested.id ?? `browser-action-${this.context.now()}`),
      cursorId: this.cursorId,
      resourceId: String(requested.resourceId ?? observation.resourceId),
      resourceKind: "browser",
      actionKind: requested.actionKind,
      risk: requested.risk ?? "readonly",
      priority: Number(requested.priority ?? 50),
      ttlMs: Number(requested.ttlMs ?? 10_000),
      requiresApproval: requested.requiresApproval,
      reason: String(requested.reason ?? "Browser cursor proposed action from observation."),
      payload: requested.payload ?? {},
      metadata: {
        url: observation.url,
        title: observation.title,
        ...requested.metadata,
      },
    };

    return { intent, reason: "Device action proposed." };
  }
}
