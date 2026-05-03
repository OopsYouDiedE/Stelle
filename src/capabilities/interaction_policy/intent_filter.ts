import type { Affordance } from "./affordance.js";

/**
 * 候选意图 (Candidate Intent)
 * 由认知系统产生，尚未经过可行性过滤。
 */
export interface CandidateIntent {
  intentId: string;
  actorId: string;
  /** 意图范畴 */
  scope: "reply" | "world" | "stage" | "memory" | "tool";
  summary: string;
  desiredOutcome: string;
  /** 涉及的实体引用 */
  targetRefs?: any[]; 
  /** 所需能力暗示 (来自 LLM) */
  requiredAffordanceHints?: string[];
  /** 证据引用 */
  evidenceRefs: any[];
  /** 决策理由 (正向) */
  justification: string;
}

/**
 * 意图过滤结果
 */
export type IntentFilterResult =
  | { status: "executable"; intent: CandidateIntent; affordances: Affordance[] }
  | { status: "not_executable"; intent: CandidateIntent; reason: string }
  | { status: "needs_clarification"; intent: CandidateIntent; question: string }
  | { status: "blocked"; intent: CandidateIntent; blockedBy: string };

/**
 * 意图过滤器 (Intent Filter)
 * 负责执行“硬门禁”：可执行性、权限、风险评估。
 */
export class IntentFilter {
  /**
   * 过滤候选意图
   */
  public filter(
    intents: CandidateIntent[],
    availableAffordances: Affordance[]
  ): IntentFilterResult[] {
    return intents.map((intent) => {
      // 1. 检查是否存在匹配的可执行性
      const requiredKinds = this.mapScopeToKinds(intent.scope);
      const matchingAffordances = availableAffordances.filter(
        (a) => requiredKinds.includes(a.kind) && a.isAvailable
      );

      if (matchingAffordances.length === 0) {
        return {
          status: "not_executable",
          intent,
          reason: `No available affordance found for scope: ${intent.scope}`,
        };
      }

      // 2. 检查风险 (MVP: 简单模拟)
      if (intent.summary.toLowerCase().includes("risk")) {
        return {
          status: "blocked",
          intent,
          blockedBy: "risk_gate",
        };
      }

      return {
        status: "executable",
        intent,
        affordances: matchingAffordances,
      };
    });
  }

  private mapScopeToKinds(scope: string): string[] {
    switch (scope) {
      case "reply": return ["reply"];
      case "world": return ["world_action"];
      case "stage": return ["stage_control"];
      case "memory": return ["memory_write"];
      case "tool": return ["tool_call"];
      default: return [];
    }
  }
}
