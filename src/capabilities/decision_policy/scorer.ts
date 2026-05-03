import type { IntentFilterResult, CandidateIntent } from "../interaction_policy/intent_filter.js";
import type { DecisionPolicyConfig } from "./config.js";

/**
 * 决策评分结果
 */
export interface DecisionScore {
  intentId: string;
  totalScore: number;
  breakdown: Record<string, number>;
}

/**
 * 决策评分器 (Decision Scorer)
 * 基于配置和上下文对候选意图进行打分。
 */
export class DecisionScorer {
  /**
   * 对一组通过门禁的可执行意图进行评分
   */
  public score(
    executables: Array<{ intent: CandidateIntent }>,
    config: DecisionPolicyConfig
  ): DecisionScore[] {
    return executables.map(({ intent }) => {
      // MVP: 基于意图的简短程度和 justification 长度模拟评分
      const goalFit = Math.min(1.0, intent.justification.length / 100);
      const memorySupport = intent.evidenceRefs.length > 0 ? 0.8 : 0.2;
      const novelty = Math.random(); // 模拟新颖性
      
      const breakdown = {
        goalFit: goalFit * config.weights.goalFit,
        memorySupport: memorySupport * config.weights.memorySupport,
        novelty: novelty * config.weights.novelty,
      };

      const totalScore = Object.values(breakdown).reduce((a, b) => a + b, 0);

      return {
        intentId: intent.intentId,
        totalScore,
        breakdown,
      };
    });
  }
}
