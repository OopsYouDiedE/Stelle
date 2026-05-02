// === Imports ===
import type { OutputIntent, StageOutputState } from "./types.js";

// === Types & Constants ===
const LANE_RANK: Record<OutputIntent["lane"], number> = {
  emergency: 700,
  direct_response: 600,
  topic_hosting: 500,
  live_chat: 400,
  ambient: 200,
  inner_reaction: 100,
  debug: 50,
};

export interface OutputPolicyInput {
  intent: OutputIntent;
  state: StageOutputState;
  now: number;
  debugEnabled: boolean;
  quietIntervalMs: number;
}

export type OutputPolicyDecision =
  | { action: "accept_now"; reason: string }
  | { action: "queue"; reason: string }
  | { action: "drop"; reason: string }
  | { action: "interrupt"; reason: string };

// === Logic ===
export function compareIntentPriority(a: OutputIntent, b: OutputIntent): number {
  const rankDiff = LANE_RANK[b.lane] - LANE_RANK[a.lane];
  if (rankDiff !== 0) return rankDiff;
  if (a.groupId && a.groupId === b.groupId && a.sequence !== undefined && b.sequence !== undefined) {
    return a.sequence - b.sequence;
  }
  return b.priority - a.priority;
}

export function decideOutputPolicy(input: OutputPolicyInput): OutputPolicyDecision {
  const { intent, state, now, debugEnabled, quietIntervalMs } = input;

  // Basic Validation
  if (!intent.text.trim()) return { action: "drop", reason: "empty_text" };
  if (intent.ttlMs <= 0) return { action: "drop", reason: "invalid_ttl" };
  if (intent.lane === "debug" && !debugEnabled) return { action: "drop", reason: "debug_disabled" };
  if (intent.lane === "inner_reaction") return { action: "drop", reason: "inner_reaction_not_stage_output" };

  // Lane-specific restrictions
  if (intent.lane === "ambient" && now - state.ttsBusyUntil < quietIntervalMs) {
    return { action: "drop", reason: "stage_not_quiet" };
  }

  // Availability Check
  if (!state.speaking && now >= state.ttsBusyUntil && now >= state.captionBusyUntil) {
    return { action: "accept_now", reason: "stage_free" };
  }

  // Interrupt Logic
  if (intent.interrupt === "hard") {
    const currentRank = LANE_RANK[state.currentLane ?? "ambient"] || 0;
    const incomingRank = LANE_RANK[intent.lane];

    if (incomingRank > currentRank) {
      if (intent.lane === "emergency") return { action: "interrupt", reason: "emergency_interrupt" };
      if (intent.lane === "direct_response" && state.currentLane === "ambient") {
        return { action: "interrupt", reason: "direct_response_interrupts_ambient" };
      }
      return { action: "interrupt", reason: "hard_interrupt_priority" };
    }
  }

  // Queueing
  if (intent.lane === "ambient") return { action: "drop", reason: "ambient_stage_busy" };
  return { action: "queue", reason: "stage_busy" };
}
