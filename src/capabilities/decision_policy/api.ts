import type { IntentFilterResult } from "../interaction_policy/intent_filter.js";
import { DecisionScorer, type DecisionScore } from "./scorer.js";
import { type DecisionPolicyConfig, DEFAULT_DECISION_POLICY } from "./config.js";
import type { ValueSystemApi } from "../value_system/api.js";
import { ValueSystemCapability } from "../value_system/api.js";

export interface DecisionSelection {
  selectedIntentId: string;
  score: DecisionScore;
}

export interface DecisionPolicyApi {
  /**
   * 在已过滤的候选中选择一个。
   */
  select_decision(
    executables: Array<IntentFilterResult & { status: "executable" }>,
    config?: DecisionPolicyConfig
  ): Promise<DecisionSelection | null>;
}

export class DecisionPolicyCapability implements DecisionPolicyApi {
  private readonly scorer = new DecisionScorer();
  private readonly valueSystem: ValueSystemApi = new ValueSystemCapability();

  public async select_decision(
    executables: Array<IntentFilterResult & { status: "executable" }>,
    config: DecisionPolicyConfig = DEFAULT_DECISION_POLICY
  ): Promise<DecisionSelection | null> {
    if (executables.length === 0) return null;

    const scores = this.scorer.score(executables, config);
    
    // 注入价值观评分
    for (const score of scores) {
      const intent = executables.find(e => e.intent.intentId === score.intentId)?.intent;
      if (intent) {
        const alignment = this.valueSystem.score_alignment(intent.summary);
        score.breakdown.valueAlignment = alignment * config.weights.valueAlignment;
        score.totalScore += score.breakdown.valueAlignment;
      }
    }

    // 按总分降序排序
    scores.sort((a, b) => b.totalScore - a.totalScore);

    const winner = scores[0];
    return {
      selectedIntentId: winner.intentId,
      score: winner,
    };
  }
}
