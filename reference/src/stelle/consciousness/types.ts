import type { Experience } from "../types.js";

export type ConsciousnessStrategyDecision =
  | {
      type: "continue";
      reason: string;
    }
  | {
      type: "switch_strategy";
      strategyId: string;
      reason: string;
    }
  | {
      type: "wait";
      durationMs: number;
      reason: string;
    }
  | {
      type: "complete";
      summary: string;
    }
  | {
      type: "fail";
      reason: string;
    }
  | {
      type: "act_through_cursor";
      cursorId: string;
      activationType: string;
      reason: string;
      payload?: Record<string, unknown>;
    }
  | {
      type: "inspect_cursor";
      cursorId: string;
      reason: string;
    }
  | {
      type: "remember";
      experienceIds: string[];
      reason: string;
    };

export interface ConsciousnessIdleJudgement {
  focus: Experience | null;
  shouldReflect: boolean;
  activeGoals: ConsciousnessGoal[];
  activeCommitments: ConsciousnessCommitment[];
  decisions: ConsciousnessStrategyDecision[];
  summary: string;
}

export type ConsciousnessGoalStatus = "active" | "blocked" | "completed";

export interface ConsciousnessGoal {
  id: string;
  sourceExperienceId: string;
  cursorId: string;
  cursorKind: string;
  summary: string;
  priority: number;
  status: ConsciousnessGoalStatus;
  createdAt: number;
  updatedAt: number;
  lastAdvancedAt: number | null;
}

export type ConsciousnessCommitmentStatus = "open" | "fulfilled" | "dismissed";

export interface ConsciousnessCommitment {
  id: string;
  sourceExperienceId: string;
  cursorId: string;
  cursorKind: string;
  summary: string;
  status: ConsciousnessCommitmentStatus;
  createdAt: number;
  updatedAt: number;
}
