import { truncateText } from "../utils/text.js";
import type { CursorContext, StelleEvent, BehaviorPolicy } from "./types.js";

export type BehaviorPolicyOverlay = BehaviorPolicy;
export type PolicyTarget = "discord" | "discord_text_channel" | "live" | "live_danmaku" | "browser" | "desktop_input" | "android_device" | "global";

export interface PolicyOverlay {
  id: string;
  target: PolicyTarget;
  policy: BehaviorPolicy;
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

  activePolicies(target: Exclude<PolicyTarget, "global">): BehaviorPolicy[] {
    const now = this.context.now();
    this.overlays = this.overlays.filter((d) => d.expiresAt > now);
    const aliases = targetAliases(target);
    return this.overlays
      .filter((d) => d.target === "global" || aliases.includes(d.target))
      .sort((a, b) => b.priority - a.priority || a.expiresAt - b.expiresAt)
      .map((d) => d.policy);
  }

  count(target?: Exclude<PolicyTarget, "global">): number {
    const now = this.context.now();
    this.overlays = this.overlays.filter((d) => d.expiresAt > now);
    const aliases = target ? targetAliases(target) : [];
    return target
      ? this.overlays.filter((d) => d.target === "global" || aliases.includes(d.target)).length
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
      policy: (event.payload.policy as BehaviorPolicy) || { instruction: String(event.payload.parameters?.instruction || "") },
      priority: event.payload.priority || 1,
      expiresAt,
    };
  }
}

function targetAliases(target: Exclude<PolicyTarget, "global">): PolicyTarget[] {
  if (target === "discord" || target === "discord_text_channel") return ["discord", "discord_text_channel"];
  if (target === "live" || target === "live_danmaku") return ["live", "live_danmaku"];
  return [target];
}
