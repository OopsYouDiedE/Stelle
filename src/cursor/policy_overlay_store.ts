import { truncateText } from "../utils/text.js";
import type { CursorContext, StelleEvent } from "./types.js";

export type PolicyTarget = "discord" | "live" | "global";

export interface PolicyOverlay {
  id: string;
  target: PolicyTarget;
  policy: Record<string, unknown>;
  priority: number;
  expiresAt: number;
}

export class PolicyOverlayStore {
  private overlays: PolicyOverlay[] = [];
  private unsubscribe?: () => void;

  constructor(private readonly context: CursorContext) {}

  subscribe(onApplied?: (summary: string) => void): () => void {
    this.unsubscribe = this.context.eventBus.subscribe("cursor.directive", (event: Extract<StelleEvent, { type: "cursor.directive" }>) => {
      const overlay = this.fromEvent(event);
      this.upsert(overlay);
      onApplied?.(`Directive applied: ${truncateText(String(overlay.policy.instruction || "Policy updated"), 50)}`);
    });
    return this.unsubscribe;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  activePolicies(target: "discord" | "live"): Record<string, unknown>[] {
    const now = this.context.now();
    this.overlays = this.overlays.filter((d) => d.expiresAt > now);
    return this.overlays
      .filter((d) => d.target === "global" || d.target === target)
      .sort((a, b) => b.priority - a.priority || a.expiresAt - b.expiresAt)
      .map((d) => d.policy);
  }

  count(target?: "discord" | "live"): number {
    const now = this.context.now();
    this.overlays = this.overlays.filter((d) => d.expiresAt > now);
    return target
      ? this.overlays.filter((d) => d.target === "global" || d.target === target).length
      : this.overlays.length;
  }

  private upsert(overlay: PolicyOverlay): void {
    this.overlays = this.overlays.filter((d) => d.id !== overlay.id);
    this.overlays.push(overlay);
  }

  private fromEvent(event: Extract<StelleEvent, { type: "cursor.directive" }>): PolicyOverlay {
    const expiresAt = event.payload.expiresAt || (this.context.now() + 30 * 60 * 1000);
    return {
      id: event.id,
      target: event.payload.target,
      policy: event.payload.policy || { instruction: String(event.payload.parameters?.instruction || "") },
      priority: event.payload.priority || 1,
      expiresAt,
    };
  }
}
