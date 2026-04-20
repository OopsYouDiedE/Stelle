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
import type {
  ConsciousnessCommitment,
  ConsciousnessGoal,
} from "./types.js";
import { judgeIdleAttention } from "./judge.js";
import { planIdleWindowActivations } from "./strategies.js";
import { reflectMemorableExperiences } from "../memory/reflection.js";

const REFLECTION_INTERVAL_MS = 5 * 60 * 1000;

export class ConsciousnessCursor implements CursorHost {
  readonly id = "stelle-consciousness";
  readonly kind = "consciousness";

  private readonly activations: CursorActivation[] = [];
  private currentFocusCursorId: string | null = null;
  private lastReflectionAt: number | null = null;
  private observedExperienceCount = 0;
  private lastObservedExperienceId: string | null = null;
  private readonly rememberedExperienceIds = new Set<string>();
  private readonly actedDecisionKeys = new Set<string>();
  private readonly goalSourceExperienceIds = new Set<string>();
  private readonly commitmentSourceExperienceIds = new Set<string>();
  private readonly goals = new Map<string, ConsciousnessGoal>();
  private readonly commitments = new Map<string, ConsciousnessCommitment>();
  private nextGoalId = 1;
  private nextCommitmentId = 1;
  private lastDecisions: ConsciousnessIdleResult["decisions"] = [];

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
    this.reconcileIntentState(context.recentExperiences, context.timestamp);

    const judgement = judgeIdleAttention({
      recentExperiences: context.recentExperiences,
      currentFocusCursorId: this.currentFocusCursorId,
      activeGoals: this.activeGoals(),
      activeCommitments: this.activeCommitments(),
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
    const decisions = this.filterActionDecisions(judgement.decisions);
    const idleActivations: AttentionActivation[] =
      planIdleWindowActivations({ ...judgement, decisions });
    this.lastDecisions = decisions;
    const memoryReflections = reflectMemorableExperiences({
      experiences: context.recentExperiences,
      rememberedExperienceIds: this.rememberedExperienceIds,
      timestamp: context.timestamp,
    });
    for (const reflection of memoryReflections) {
      this.rememberedExperienceIds.add(reflection.experienceId);
    }

    if (judgement.shouldReflect) {
      this.lastReflectionAt = context.timestamp;
      reports.push({
        cursorId: this.id,
        type: "idle_reflection",
        summary: judgement.summary,
        payload: {
          focusCursorId: this.currentFocusCursorId,
          registeredWindowIds: context.windows.registeredCursorIds,
          decisions,
          activeGoals: judgement.activeGoals,
          activeCommitments: judgement.activeCommitments,
          recentExperienceIds: context.recentExperiences.map((item) => item.id),
          memoryReflectionCount: memoryReflections.length,
        },
        timestamp: context.timestamp,
      });
    }

    return {
      reports,
      idleActivations,
      memoryReflections,
      decisions,
    };
  }

  private filterActionDecisions(
    decisions: ConsciousnessIdleResult["decisions"]
  ): ConsciousnessIdleResult["decisions"] {
    return decisions.filter((decision) => {
      if (decision.type !== "act_through_cursor") return true;
      const sourceExperienceId =
        typeof decision.payload?.sourceExperienceId === "string"
          ? decision.payload.sourceExperienceId
          : null;
      if (!sourceExperienceId) return true;
      const key = [
        sourceExperienceId,
        decision.cursorId,
        decision.activationType,
        typeof decision.payload?.action === "object" &&
        decision.payload.action &&
        "type" in decision.payload.action
          ? String((decision.payload.action as { type: unknown }).type)
          : "",
      ].join(":");
      if (this.actedDecisionKeys.has(key)) return false;
      this.actedDecisionKeys.add(key);
      return true;
    });
  }

  snapshot(): ConsciousnessSnapshot {
    return {
      id: this.id,
      kind: this.kind,
      currentFocusCursorId: this.currentFocusCursorId,
      lastReflectionAt: this.lastReflectionAt,
      observedExperienceCount: this.observedExperienceCount,
      activeGoals: this.activeGoals(),
      activeCommitments: this.activeCommitments(),
      lastDecisions: this.lastDecisions,
    };
  }

  private reconcileIntentState(
    experiences: ConsciousnessIdleContext["recentExperiences"],
    timestamp: number
  ): void {
    for (const experience of experiences) {
      this.updateExistingGoals(experience, timestamp);

      if (this.shouldCreateGoal(experience)) {
        const goal: ConsciousnessGoal = {
          id: `goal-${this.nextGoalId++}`,
          sourceExperienceId: experience.id,
          cursorId: experience.sourceCursorId,
          cursorKind: experience.sourceKind,
          summary: experience.summary,
          priority: experience.salience,
          status: "active",
          createdAt: timestamp,
          updatedAt: timestamp,
          lastAdvancedAt: null,
        };
        this.goals.set(goal.id, goal);
        this.goalSourceExperienceIds.add(experience.id);
      }

      if (this.shouldCreateCommitment(experience)) {
        const commitment: ConsciousnessCommitment = {
          id: `commitment-${this.nextCommitmentId++}`,
          sourceExperienceId: experience.id,
          cursorId: experience.sourceCursorId,
          cursorKind: experience.sourceKind,
          summary: experience.summary,
          status: "open",
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        this.commitments.set(commitment.id, commitment);
        this.commitmentSourceExperienceIds.add(experience.id);
      }
    }

    this.trimIntentState();
  }

  private shouldCreateGoal(
    experience: ConsciousnessIdleContext["recentExperiences"][number]
  ): boolean {
    if (this.goalSourceExperienceIds.has(experience.id)) return false;
    if (experience.sourceKind === "consciousness") return false;
    if (
      experience.type === "message_processed" ||
      experience.type === "typing_observed" ||
      experience.type === "typing_start" ||
      experience.type === "attention_inspected" ||
      experience.type === "status" ||
      experience.type === "observation"
    ) {
      return false;
    }
    if (this.isTerminalExperience(experience)) return false;
    return experience.salience >= 0.75;
  }

  private shouldCreateCommitment(
    experience: ConsciousnessIdleContext["recentExperiences"][number]
  ): boolean {
    if (this.commitmentSourceExperienceIds.has(experience.id)) return false;
    if (experience.sourceKind === "consciousness") return false;
    return /答应|承诺|待办|稍后|提醒|记得|remember|remind|todo|later|follow up/i.test(
      experience.summary
    );
  }

  private updateExistingGoals(
    experience: ConsciousnessIdleContext["recentExperiences"][number],
    timestamp: number
  ): void {
    for (const goal of this.goals.values()) {
      if (goal.cursorId !== experience.sourceCursorId) continue;
      if (goal.status !== "active") continue;

      if (this.isFailureExperience(experience)) {
        goal.status = "blocked";
        goal.updatedAt = timestamp;
        goal.lastAdvancedAt = timestamp;
      } else if (this.isTerminalExperience(experience)) {
        goal.status = "completed";
        goal.updatedAt = timestamp;
        goal.lastAdvancedAt = timestamp;
      } else if (experience.salience >= 0.5) {
        goal.updatedAt = timestamp;
        goal.lastAdvancedAt = timestamp;
      }
    }
  }

  private isFailureExperience(
    experience: ConsciousnessIdleContext["recentExperiences"][number]
  ): boolean {
    const text = `${experience.type} ${experience.summary}`.toLowerCase();
    return text.includes("error") || text.includes("failed") || text.includes("rejected");
  }

  private isTerminalExperience(
    experience: ConsciousnessIdleContext["recentExperiences"][number]
  ): boolean {
    const text = `${experience.type} ${experience.summary}`.toLowerCase();
    return (
      text.includes("complete") ||
      text.includes("completed") ||
      text.includes("done") ||
      text.includes("succeeded")
    );
  }

  private activeGoals(): ConsciousnessGoal[] {
    return [...this.goals.values()]
      .filter((goal) => goal.status === "active")
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
      .slice(0, 8);
  }

  private activeCommitments(): ConsciousnessCommitment[] {
    return [...this.commitments.values()]
      .filter((commitment) => commitment.status === "open")
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, 8);
  }

  private trimIntentState(): void {
    this.trimMap(this.goals, 50);
    this.trimMap(this.commitments, 50);
  }

  private trimMap<T extends { createdAt: number }>(items: Map<string, T>, max: number): void {
    if (items.size <= max) return;
    const removable = [...items.entries()].sort(
      (a, b) => a[1].createdAt - b[1].createdAt
    );
    for (const [id] of removable.slice(0, items.size - max)) {
      items.delete(id);
    }
  }
}
