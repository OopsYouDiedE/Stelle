import type { CursorContext, CursorSnapshot, StelleCursor } from "./types.js";
import { PolicyOverlayStore } from "./policy_overlay_store.js";

/**
 * BaseStatefulCursor
 * 
 * Provides a common foundation for cursors that use the Gateway-Router-Executor-Responder pattern.
 * Manages lifecycle, policy store subscriptions, and reflection reporting.
 */
export abstract class BaseStatefulCursor implements StelleCursor {
  abstract readonly id: string;
  abstract readonly kind: string;
  abstract readonly displayName: string;

  protected status: CursorSnapshot["status"] = "idle";
  protected summary = "Initializing...";

  protected readonly policyStore: PolicyOverlayStore;
  protected unsubscribes: (() => void)[] = [];

  constructor(protected readonly context: CursorContext) {
    this.policyStore = new PolicyOverlayStore(context);
  }

  async initialize(): Promise<void> {
    // Shared: Subscribe to runtime policy directives from InnerMind
    this.unsubscribes.push(this.policyStore.subscribe((summary) => { 
      this.summary = summary; 
    }));

    await this.onInitialize();
  }

  /**
   * Hook for platform-specific initialization.
   */
  protected abstract onInitialize(): Promise<void>;

  async stop(): Promise<void> {
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
    await this.onStop();
  }

  /**
   * Hook for platform-specific cleanup.
   */
  protected abstract onStop(): Promise<void>;

  /**
   * Returns a standard snapshot of the cursor state.
   */
  abstract snapshot(): CursorSnapshot;

  /**
   * Centralized reflection reporting.
   */
  protected reportReflection(intent: string, summary: string, impactScore: number, salience: "low" | "medium" | "high" = "medium") {
    this.context.eventBus.publish({
      type: "cursor.reflection",
      source: this.id as any,
      id: `refl-${this.context.now()}`,
      timestamp: this.context.now(),
      payload: { intent, summary, impactScore, salience }
    });
  }

  /**
   * Utility to check if all decisions were dropped (common in both cursors).
   */
  protected allDropped(decisions: any[]): boolean {
    return decisions.length > 0 && decisions.every(d => d.status === "dropped");
  }

  /**
   * Utility to collect drop reasons.
   */
  protected getDropReasons(decisions: any[]): string {
    return decisions.map(d => d.reason).filter(Boolean).join(", ") || "dropped";
  }
}
