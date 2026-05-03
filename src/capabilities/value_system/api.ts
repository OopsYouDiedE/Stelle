import { type ValueProfile, DEFAULT_VALUE_PROFILE } from "./profile.js";

export interface ValueSystemApi {
  get_profile(): ValueProfile;
  score_alignment(actionSummary: string): number;
}

/**
 * 价值观系统 (Value System)
 * 负责评估行为与 Agent 核心价值观的对齐程度。
 */
export class ValueSystemCapability implements ValueSystemApi {
  private profile: ValueProfile = DEFAULT_VALUE_PROFILE;

  public get_profile(): ValueProfile {
    return { ...this.profile };
  }

  /**
   * 评分对齐度
   * MVP: 简单地检查禁忌词。
   */
  public score_alignment(actionSummary: string): number {
    const summaryLower = actionSummary.toLowerCase();
    for (const taboo of this.profile.taboos) {
      if (summaryLower.includes(taboo.toLowerCase())) {
        return 0.0; // 触碰禁忌
      }
    }
    return 1.0; // 默认满分
  }
}
