import type { CursorContext } from "../types.js";
import type { DeviceActionDecision, DeviceActionIntent } from "../../device/action_types.js";
import { truncateText } from "../../utils/text.js";
import type { DeviceObservationRouteDecision } from "./device_observation_cursor.js";

// === Types & Interfaces ===

interface BaseDeviceObservation {
  resourceId: string;
  requestedAction?: Partial<DeviceActionIntent>;
}

interface DeviceIntentDefaults {
  resourceKind: DeviceActionIntent["resourceKind"];
  idPrefix: string;
  defaultTtlMs: number;
  defaultReason: string;
}

// === Gateway ===

export class DeviceObservationGateway<Observation> {
  private latest?: Observation;

  receive(observation: Observation): Observation {
    this.latest = observation;
    return observation;
  }

  snapshot(): Observation | undefined {
    return this.latest;
  }
}

// === Executor ===

export class DeviceObservationExecutor {
  constructor(protected readonly context: CursorContext) {}

  async execute(intent: DeviceActionIntent): Promise<DeviceActionDecision> {
    if (!this.context.deviceAction) {
      return { status: "rejected", reason: "DeviceActionArbiter is not configured.", intent };
    }
    return this.context.deviceAction.propose(intent);
  }
}

// === Responder ===

export class DeviceObservationResponder {
  constructor(private readonly actionLabel: string) {}

  summarize(decision: DeviceActionDecision): string {
    return `${this.actionLabel} ${decision.status}: ${truncateText(decision.reason, 80)}`;
  }
}

// === Router ===

export abstract class DeviceObservationRouter<
  Observation extends BaseDeviceObservation,
  Decision extends DeviceObservationRouteDecision,
> {
  constructor(
    protected readonly context: CursorContext,
    protected readonly cursorId: string,
  ) {}

  abstract decide(observation: Observation): Decision;

  protected buildIntent(observation: Observation, defaults: DeviceIntentDefaults): DeviceActionIntent | undefined {
    const requested = observation.requestedAction;
    if (!requested?.actionKind) {
      return undefined;
    }

    return {
      id: String(requested.id ?? `${defaults.idPrefix}-${this.context.now()}`),
      cursorId: this.cursorId,
      resourceId: String(requested.resourceId ?? observation.resourceId),
      resourceKind: defaults.resourceKind,
      actionKind: requested.actionKind,
      risk: requested.risk ?? this.defaultRiskFor(requested.actionKind),
      priority: Number(requested.priority ?? 50),
      createdAt: this.context.now(),
      ttlMs: Number(requested.ttlMs ?? defaults.defaultTtlMs),
      requiresApproval: requested.requiresApproval,
      reason: String(requested.reason ?? defaults.defaultReason),
      payload: requested.payload ?? {},
      metadata: {
        ...this.getObservationMetadata(observation),
        ...requested.metadata,
      },
    };
  }

  protected abstract defaultRiskFor(actionKind: DeviceActionIntent["actionKind"]): DeviceActionIntent["risk"];
  protected abstract getObservationMetadata(observation: Observation): Record<string, unknown>;
}
