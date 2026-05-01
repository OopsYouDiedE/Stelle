import { truncateText } from "../utils/text.js";
import type { CursorContext, StelleEvent, BehaviorPolicy } from "./types.js";

// === Types & Interfaces ===
export type BehaviorPolicyOverlay = BehaviorPolicy;
export type PolicyTarget =
  | "discord"
  | "discord_text_channel"
  | "live"
  | "live_danmaku"
  | "browser"
  | "desktop_input"
  | "android_device"
  | "global";

/**
 * 人格状态与角色扮演开关
 * 取代 regex 过滤（猫娘、零食、特定梗）
 */
export interface PersonaState {
  roleplayEnabled: boolean;
  activeBits: string[]; // 当前激活的梗或人设碎片 (e.g. "snack_detective", "cat_bit")
  vibeIntensity: number; // 情感强度 1-5
  tempo: "calm" | "fast"; // 说话节奏
}

export interface PolicyOverlay {
  id: string;
  target: PolicyTarget;
  policy: BehaviorPolicy;
  priority: number;
  expiresAt: number;
}

// === Store Implementation ===
export class PolicyOverlayStore {
  private overlays: PolicyOverlay[] = [];
  private unsubscribe?: () => void;

  constructor(private readonly context: CursorContext) {}

  subscribe(onApplied?: (summary: string) => void): () => void {
    this.unsubscribe = this.context.eventBus.subscribe(
      "cursor.directive",
      (event: Extract<StelleEvent, { type: "cursor.directive" }>) => {
        const overlay = this.fromEvent(event);
        this.upsert(overlay);
        onApplied?.(`Directive applied: ${truncateText(String(overlay.policy.instruction || "Policy updated"), 50)}`);
      },
    );
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

  getPersonaState(target: Exclude<PolicyTarget, "global">): PersonaState {
    const policies = this.activePolicies(target);
    const state: PersonaState = {
      roleplayEnabled: false,
      activeBits: [],
      vibeIntensity: 3,
      tempo: "calm",
    };

    // Merge policies from lowest to highest priority
    for (const p of [...policies].reverse()) {
      if (p.persona?.roleplayEnabled !== undefined) state.roleplayEnabled = p.persona.roleplayEnabled;
      if (p.persona?.activeBits) {
        state.activeBits = [...new Set([...state.activeBits, ...p.persona.activeBits])];
      }
      if (p.vibeIntensity !== undefined) state.vibeIntensity = p.vibeIntensity;
    }

    return state;
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
    const expiresAt = event.payload.expiresAt || this.context.now() + 30 * 60 * 1000;
    return {
      id: event.id,
      target: event.payload.target,
      policy: (event.payload.policy as BehaviorPolicy) || {
        instruction: String(event.payload.parameters?.instruction || ""),
      },
      priority: event.payload.priority || 1,
      expiresAt,
    };
  }
}

// === Internal Helpers ===
function targetAliases(target: Exclude<PolicyTarget, "global">): PolicyTarget[] {
  if (target === "discord" || target === "discord_text_channel") return ["discord", "discord_text_channel"];
  if (target === "live" || target === "live_danmaku") return ["live", "live_danmaku"];
  return [target];
}
