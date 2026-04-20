import type { WindowRegistrySnapshot } from "../../core/windowRegistry.js";
import type { Experience } from "../types.js";
import type {
  ConsciousnessIdleJudgement,
  ConsciousnessStrategyDecision,
} from "./types.js";

export function judgeIdleAttention(input: {
  recentExperiences: Experience[];
  currentFocusCursorId: string | null;
  lastObservedExperienceId: string | null;
  lastReflectionAt: number | null;
  reflectionIntervalMs: number;
  timestamp: number;
  windows: WindowRegistrySnapshot;
}): ConsciousnessIdleJudgement {
  const focus = chooseFocus(input.recentExperiences, input.currentFocusCursorId);
  const latestExperienceId = input.recentExperiences.at(-1)?.id ?? null;
  const shouldReflect =
    latestExperienceId !== input.lastObservedExperienceId ||
    input.lastReflectionAt === null ||
    input.timestamp - input.lastReflectionAt >= input.reflectionIntervalMs;

  return {
    focus,
    shouldReflect,
    decisions: buildIdleDecisions({
      focus,
      shouldReflect,
      experiences: input.recentExperiences,
      windows: input.windows,
    }),
    summary: buildReflectionSummary(focus, input.windows),
  };
}

function chooseFocus(
  experiences: Experience[],
  fallbackCursorId: string | null
): Experience | null {
  if (!experiences.length) return null;
  const focused = fallbackCursorId
    ? [...experiences]
        .reverse()
        .find((item: Experience) => item.sourceCursorId === fallbackCursorId)
    : null;
  const candidatePool = focused ? [focused, ...experiences] : experiences;
  return [...candidatePool].sort((a, b) => b.salience - a.salience)[0] ?? null;
}

function buildReflectionSummary(
  focus: Experience | null,
  windows: WindowRegistrySnapshot
): string {
  if (!focus) {
    const kinds = windows.registeredWindows
      .map((window) => window.kind)
      .filter((kind, index, all) => all.indexOf(kind) === index)
      .join(", ");
    return `Stelle is idle with ${windows.registeredCursorIds.length} window(s) available${kinds ? ` (${kinds})` : ""}, keeping quiet internal attention.`;
  }
  return `Stelle reflects on ${focus.sourceKind}/${focus.sourceCursorId}: ${focus.summary}`;
}

function buildIdleDecisions(input: {
  focus: Experience | null;
  shouldReflect: boolean;
  experiences: Experience[];
  windows: WindowRegistrySnapshot;
}): ConsciousnessStrategyDecision[] {
  const decisions: ConsciousnessStrategyDecision[] = [];
  const memorableIds = input.experiences
    .filter((experience) => experience.salience >= 0.7)
    .map((experience) => experience.id);

  if (memorableIds.length) {
    decisions.push({
      type: "remember",
      experienceIds: memorableIds,
      reason: "Recent high-salience experiences should be considered for long-term memory.",
    });
  }

  if (input.focus) {
    decisions.push({
      type: "inspect_cursor",
      cursorId: input.focus.sourceCursorId,
      reason: `Attention is focused on ${input.focus.sourceKind}/${input.focus.sourceCursorId}.`,
    });
  }

  if (!decisions.length) {
    decisions.push({
      type: "wait",
      durationMs: 15_000,
      reason: `No salient experience is pending across ${input.windows.registeredCursorIds.length} window(s).`,
    });
  }

  return decisions;
}
