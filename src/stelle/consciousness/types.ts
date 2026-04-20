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
  decisions: ConsciousnessStrategyDecision[];
  summary: string;
}
