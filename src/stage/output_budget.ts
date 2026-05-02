// === Imports ===
import { sanitizeExternalText, truncateText } from "../utils/text.js";
import type { OutputIntent, OutputLane } from "./output_types.js";

// === Types & Constants ===
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

// === Logic ===
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

export function splitOutputText(text: string, lane: OutputLane, maxItems = 12): string[] {
  const clean = sanitizeExternalText(text);
  if (!clean) return [];

  const budget = budgetForLane(lane);
  const maxChars = outputChunkMaxChars(lane, budget.maxChars);
  const roughParts = clean
    .split(/(?<=[\u3002\uff01\uff1f.!?])\s*|\n+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  const parts = roughParts.length > 0 ? roughParts : [clean];
  const chunks: string[] = [];

  for (const part of parts) {
    chunks.push(...splitLongOutputPart(part, maxChars));
    if (chunks.length >= maxItems) return chunks.slice(0, maxItems);
  }

  return chunks;
}

function outputChunkMaxChars(lane: OutputLane, laneBudgetChars: number): number {
  const target =
    lane === "topic_hosting"
      ? 38
      : lane === "direct_response"
        ? 42
        : lane === "debug"
          ? 54
          : lane === "emergency"
            ? 48
            : 40;
  return Math.max(20, Math.min(laneBudgetChars, target));
}

function splitLongOutputPart(text: string, maxChars: number): string[] {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return [text];

  const chunks: string[] = [];
  let rest = text;

  while (Array.from(rest).length > maxChars) {
    const restChars = Array.from(rest);
    const window = restChars.slice(0, maxChars + 1).join("");
    const breakAt = findNaturalBreak(window, maxChars);
    const head = sanitizeExternalText(restChars.slice(0, breakAt).join(""));
    if (head) chunks.push(head);
    rest = restChars.slice(breakAt).join("").trimStart();
  }

  const tail = sanitizeExternalText(rest);
  if (tail) chunks.push(tail);
  return chunks;
}

function findNaturalBreak(text: string, maxChars: number): number {
  const chars = Array.from(text);
  const preferred = ["，", "、", "；", ";", ",", "：", ":"];

  for (const mark of preferred) {
    const idx = text.lastIndexOf(mark);
    if (idx >= 12) return Array.from(text.slice(0, idx + mark.length)).length;
  }

  return Math.min(chars.length, maxChars);
}
