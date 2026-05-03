/**
 * 决策策略配置 (Decision Policy Config)
 */
export interface DecisionPolicyConfig {
  /** 评分权重 */
  weights: {
    /** 目标契合度 */
    goalFit: number;
    /** 价值观对齐 */
    valueAlignment: number;
    /** 记忆支持度 */
    memorySupport: number;
    /** 新颖性 */
    novelty: number;
    /** 连贯性 */
    continuity: number;
  };
  /** 风险控制 */
  risk: {
    /** 超过此分数直接拒绝 */
    rejectAbove: number;
    /** 风险惩罚曲线 */
    penaltyCurve: "linear" | "quadratic" | "threshold";
  };
}

export const DEFAULT_DECISION_POLICY: DecisionPolicyConfig = {
  weights: {
    goalFit: 0.4,
    valueAlignment: 0.2,
    memorySupport: 0.2,
    novelty: 0.1,
    continuity: 0.1,
  },
  risk: {
    rejectAbove: 0.8,
    penaltyCurve: "quadratic",
  },
};
