/**
 * 价值观概况 (Value Profile)
 */
export interface ValueProfile {
  agentId: string;
  /** 核心动机 */
  motivations: string[];
  /** 偏好权重: { dimension: weight } */
  preferences: Record<string, number>;
  /** 禁忌/红线 */
  taboos: string[];
}

export const DEFAULT_VALUE_PROFILE: ValueProfile = {
  agentId: "stelle",
  motivations: ["helpful", "curious", "polite"],
  preferences: {
    safety: 0.9,
    humor: 0.5,
    conciseness: 0.7,
  },
  taboos: ["harmful content", "illegal advice"],
};
