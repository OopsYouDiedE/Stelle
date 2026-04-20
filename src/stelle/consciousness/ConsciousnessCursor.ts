import type {
  CursorActivation,
  CursorHost,
  CursorReport,
} from "../../cursors/base.js";
import type {
  ConsciousnessIdleContext,
  ConsciousnessIdleResult,
  ConsciousnessSnapshot,
  AttentionActivation,
} from "../types.js";
import { judgeIdleAttention } from "./judge.js";
import { planIdleWindowActivations } from "./strategies.js";

const REFLECTION_INTERVAL_MS = 5 * 60 * 1000;

export class ConsciousnessCursor implements CursorHost {
  readonly id = "stelle-consciousness";
  readonly kind = "consciousness";

  private readonly activations: CursorActivation[] = [];
  private currentFocusCursorId: string | null = null;
  private lastReflectionAt: number | null = null;
  private observedExperienceCount = 0;
  private lastObservedExperienceId: string | null = null;

  async activate(input: CursorActivation): Promise<void> {
    this.activations.push(input);
  }

  async tick(): Promise<CursorReport[]> {
    if (!this.activations.length) return [];
    const activations = this.activations.splice(0);
    const latest = activations.at(-1);
    return [
      {
        cursorId: this.id,
        type: "consciousness_activation",
        summary: latest
          ? `Internal attention received ${activations.length} activation(s); latest reason: ${latest.reason}.`
          : "Internal attention received activation.",
        payload: { activations },
        timestamp: Date.now(),
      },
    ];
  }

  async runIdleCycle(
    context: ConsciousnessIdleContext
  ): Promise<ConsciousnessIdleResult> {
    const judgement = judgeIdleAttention({
      recentExperiences: context.recentExperiences,
      currentFocusCursorId: this.currentFocusCursorId,
      lastObservedExperienceId: this.lastObservedExperienceId,
      lastReflectionAt: this.lastReflectionAt,
      reflectionIntervalMs: REFLECTION_INTERVAL_MS,
      timestamp: context.timestamp,
      windows: context.windows,
    });
    this.currentFocusCursorId =
      judgement.focus?.sourceCursorId ?? this.currentFocusCursorId;
    this.observedExperienceCount = context.recentExperiences.length;

    const latestExperienceId = context.recentExperiences.at(-1)?.id ?? null;
    this.lastObservedExperienceId = latestExperienceId;

    const reports: CursorReport[] = [];
    const idleActivations: AttentionActivation[] =
      planIdleWindowActivations(judgement);

    if (judgement.shouldReflect) {
      this.lastReflectionAt = context.timestamp;
      reports.push({
        cursorId: this.id,
        type: "idle_reflection",
        summary: judgement.summary,
        payload: {
          focusCursorId: this.currentFocusCursorId,
          registeredWindowIds: context.windows.registeredCursorIds,
          recentExperienceIds: context.recentExperiences.map((item) => item.id),
        },
        timestamp: context.timestamp,
      });
    }

    return { reports, idleActivations };
  }

  snapshot(): ConsciousnessSnapshot {
    return {
      id: this.id,
      kind: this.kind,
      currentFocusCursorId: this.currentFocusCursorId,
      lastReflectionAt: this.lastReflectionAt,
      observedExperienceCount: this.observedExperienceCount,
    };
  }
}
