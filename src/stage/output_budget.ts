import { truncateText } from "../utils/text.js";
import type { OutputIntent, OutputLane } from "./output_types.js";

export interface OutputBudget {
  maxChars: number;
  ttsBudgetMs: number;
}

const LANE_BUDGETS: Record<OutputLane, OutputBudget> = {
  emergency: { maxChars: 120, ttsBudgetMs: 12_000 },
  direct_response: { maxChars: 120, ttsBudgetMs: 10_000 },
  topic_hosting: { maxChars: 100, ttsBudgetMs: 9_000 },
  live_chat: { maxChars: 90, ttsBudgetMs: 8_000 },
  ambient: { maxChars: 64, ttsBudgetMs: 5_000 },
  inner_reaction: { maxChars: 48, ttsBudgetMs: 4_000 },
  debug: { maxChars: 160, ttsBudgetMs: 12_000 },
};

export function budgetForLane(lane: OutputLane): OutputBudget {
  return LANE_BUDGETS[lane];
}

export function estimateDurationMs(text: string): number {
  return Math.max(1_500, Math.min(15_000, text.length * 180));
}

export function applyOutputBudget(intent: OutputIntent): OutputIntent {
  const budget = budgetForLane(intent.lane);
  const text = truncateText(intent.text.trim(), budget.maxChars);
  return {
    ...intent,
    text,
    estimatedDurationMs: Math.min(intent.estimatedDurationMs ?? estimateDurationMs(text), budget.ttsBudgetMs),
  };
}
