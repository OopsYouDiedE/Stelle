import type { Experience } from "../types.js";
import type { MemoryReflection } from "./types.js";

const MEMORY_SALIENCE_THRESHOLD = 0.7;

export function reflectMemorableExperiences(input: {
  experiences: readonly Experience[];
  rememberedExperienceIds: ReadonlySet<string>;
  timestamp: number;
}): MemoryReflection[] {
  return input.experiences
    .filter((experience) => shouldRemember(experience, input.rememberedExperienceIds))
    .map((experience) => ({
      experienceId: experience.id,
      sourceCursorId: experience.sourceCursorId,
      sourceKind: experience.sourceKind,
      experienceType: experience.type,
      summary: experience.summary,
      reason: buildReason(experience),
      salience: experience.salience,
      createdAt: input.timestamp,
    }));
}

function shouldRemember(
  experience: Experience,
  rememberedExperienceIds: ReadonlySet<string>
): boolean {
  if (rememberedExperienceIds.has(experience.id)) return false;
  if (experience.sourceKind === "consciousness") return false;
  if (experience.type === "typing_start") return false;
  return experience.salience >= MEMORY_SALIENCE_THRESHOLD;
}

function buildReason(experience: Experience): string {
  if (experience.type.toLowerCase().includes("error")) {
    return "High-salience failure or error from an external window.";
  }
  if (experience.type.toLowerCase().includes("message")) {
    return "Potentially important social experience.";
  }
  if (experience.type.toLowerCase().includes("complete")) {
    return "Completed action that may matter for future continuity.";
  }
  return "High-salience experience selected by consciousness.";
}
