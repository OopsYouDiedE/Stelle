import type { StelleEventBus } from "../../../utils/event_bus.js";

/**
 * Base interface for all actuator intents.
 */
export interface ActuatorIntent {
  id: string;
  cursorId: string;
}

/**
 * Common dependencies for all arbiters.
 */
export interface BaseArbiterDeps {
  eventBus?: StelleEventBus;
  now: () => number;
}

/**
 * Base logic for all Actuator Arbiters.
 * Handles event publishing and core state structure.
 */
export abstract class BaseArbiter<TIntent extends ActuatorIntent, TDecision, TSnapshot> {
  protected recentOutputs: Array<{ timestamp: number; intent: TIntent; decision: TDecision }> = [];
  protected readonly MAX_HISTORY = 50;

  constructor(
    protected readonly arbiterId: string,
    protected readonly deps: BaseArbiterDeps,
  ) {}

  abstract propose(input: unknown): Promise<TDecision>;
  abstract snapshot(): TSnapshot;

  protected record(intent: TIntent, decision: TDecision): void {
    this.recentOutputs.push({ timestamp: this.deps.now(), intent, decision });
    if (this.recentOutputs.length > this.MAX_HISTORY) {
      this.recentOutputs.shift();
    }
  }

  protected publish(subType: string, intent: TIntent, metadata: Record<string, unknown> = {}): void {
    this.deps.eventBus?.publish({
      type: `${this.arbiterId}.${subType}` as any,
      source: "actuator",
      id: `${intent.id}-${subType}-${this.deps.now()}`,
      timestamp: this.deps.now(),
      payload: { intent, ...metadata },
    } as any);
  }
}
