import type { StelleEventBus } from "../utils/event_bus.js";

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
export interface ArbiterDeps {
  eventBus?: StelleEventBus;
  now: () => number;
}

/**
 * Abstract BaseArbiter that provides standard event publishing and structure.
 * 
 * @template TIntent The specific intent type.
 * @template TDecision The decision result type of propose().
 * @template TSnapshot The state snapshot type.
 */
export abstract class BaseArbiter<TIntent extends ActuatorIntent, TDecision, TSnapshot> {
  protected constructor(
    protected readonly source: string,
    protected readonly deps: ArbiterDeps
  ) {}

  /**
   * Propose an intent to the arbiter.
   */
  abstract propose(intent: TIntent): Promise<TDecision>;

  /**
   * Get a snapshot of the current arbiter state.
   */
  abstract snapshot(): TSnapshot;

  /**
   * Publishes an arbiter event to the event bus.
   */
  protected publish(type: string, intent: TIntent, payload: Record<string, any>): void {
    this.deps.eventBus?.publish({
      type: type as any,
      source: this.source as any,
      id: `${type}-${intent.id}`,
      timestamp: this.deps.now(),
      payload: { intent, ...payload },
    });
  }
}
