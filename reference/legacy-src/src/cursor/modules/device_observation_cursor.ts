import type { DeviceActionDecision, DeviceActionIntent } from "../../device/action_types.js";
import type { StelleEventType } from "../../utils/event_schema.js";
import type { CursorContext, CursorSnapshot, StelleCursor, StelleEvent } from "../types.js";

// === Types & Interfaces ===

export interface DeviceObservationRouteDecision {
  intent?: DeviceActionIntent;
  reason: string;
}

export interface DeviceObservationCursorOptions<Observation, Decision extends DeviceObservationRouteDecision> {
  id: string;
  kind: string;
  displayName: string;
  eventType: StelleEventType;
  logPrefix: string;
  initialSummary: string;
  gateway: {
    receive(observation: Observation): Observation;
    snapshot(): Observation | undefined;
  };
  observer: {
    normalize(payload: Record<string, unknown>): Observation;
  };
  router: {
    decide(observation: Observation): Decision;
  };
  executor: {
    execute(intent: DeviceActionIntent): Promise<DeviceActionDecision>;
  };
  responder: {
    summarize(decision: DeviceActionDecision): string;
  };
}

type ObservationEvent = StelleEvent & { payload: Record<string, unknown> };

// === Cursor Implementation ===

export class DeviceObservationCursor<
  Observation,
  Decision extends DeviceObservationRouteDecision,
> implements StelleCursor {
  readonly id: string;
  readonly kind: string;
  readonly displayName: string;

  private status: CursorSnapshot["status"] = "idle";
  private summary: string;
  private unsubscribes: (() => void)[] = [];

  constructor(
    private readonly context: CursorContext,
    private readonly options: DeviceObservationCursorOptions<Observation, Decision>,
  ) {
    this.id = options.id;
    this.kind = options.kind;
    this.displayName = options.displayName;
    this.summary = options.initialSummary;
  }

  async initialize(): Promise<void> {
    this.unsubscribes.push(
      this.context.eventBus.subscribe(this.options.eventType, (event) => {
        void this.receiveObservation((event as ObservationEvent).payload).catch((e) =>
          console.error(`${this.options.logPrefix} Observation failed:`, e),
        );
      }),
    );
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
  }

  async receiveObservation(payload: Record<string, unknown>): Promise<{ accepted: boolean; reason: string }> {
    this.status = "active";
    try {
      const observation = this.options.gateway.receive(this.options.observer.normalize(payload));
      const decision = this.options.router.decide(observation);
      if (!decision.intent) {
        this.summary = decision.reason;
        return { accepted: true, reason: decision.reason };
      }

      this.status = "waiting";
      const result = await this.options.executor.execute(decision.intent);
      this.summary = this.options.responder.summarize(result);
      return { accepted: result.status === "completed" || result.status === "accepted", reason: result.reason };
    } finally {
      this.status = "idle";
    }
  }

  snapshot(): CursorSnapshot {
    return {
      id: this.id,
      kind: this.kind,
      status: this.status,
      summary: this.summary,
      state: {
        latest: this.options.gateway.snapshot(),
      },
    };
  }
}
