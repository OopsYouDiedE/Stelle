import type { WindowRegistrySnapshot } from "../../core/windowRegistry.js";
import type { Experience } from "../types.js";
import type { ConsciousnessIdleJudgement } from "./types.js";

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
    return `Stelle is idle with ${windows.registeredCursorIds.length} window(s) available, keeping quiet internal attention.`;
  }
  return `Stelle reflects on ${focus.sourceKind}/${focus.sourceCursorId}: ${focus.summary}`;
}
