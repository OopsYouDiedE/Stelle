import type { OutputIntent, StageOutputState } from "./output_types.js";

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
  
  if (!intent.text.trim()) return { action: "drop", reason: "empty_text" };
  if (intent.ttlMs <= 0) return { action: "drop", reason: "invalid_ttl" };
  if (intent.lane === "debug" && !debugEnabled) return { action: "drop", reason: "debug_disabled" };
  if (intent.lane === "inner_reaction") return { action: "drop", reason: "inner_reaction_not_stage_output" };

  if (intent.lane === "ambient" && now - state.ttsBusyUntil < quietIntervalMs) {
    return { action: "drop", reason: "stage_not_quiet" };
  }

  if (!state.speaking && now >= state.ttsBusyUntil && now >= state.captionBusyUntil) {
    return { action: "accept_now", reason: "stage_free" };
  }

  // Interrupt logic: Only allow actual 'interrupt' action if it's a hard interrupt or outranks current ambient
  if (intent.interrupt === "hard" && LANE_RANK[intent.lane] > (LANE_RANK[state.currentLane ?? "ambient"] || 0)) {
    return { action: "interrupt", reason: "hard_interrupt_priority" };
  }

  if (intent.lane === "emergency" && intent.interrupt === "hard") {
    return { action: "interrupt", reason: "emergency_interrupt" };
  }

  if (intent.lane === "direct_response" && state.currentLane === "ambient" && intent.interrupt === "hard") {
    return { action: "interrupt", reason: "direct_response_interrupts_ambient" };
  }

  if (intent.lane === "ambient") return { action: "drop", reason: "ambient_stage_busy" };
  return { action: "queue", reason: "stage_busy" };
}
