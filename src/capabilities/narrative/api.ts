import type { DecisionTrace } from "../../core/execution/cycle_journal.js";

/**
 * 叙事片段 (Narrative Fragment)
 */
export interface NarrativeFragment {
  fragmentId: string;
  summary: string;
  mood: string;
  importance: number;
}

/**
 * 叙事生成器 (Narrative Generator)
 * 负责将决策和世界变化转化为连续的故事或直播叙事。
 */
export class NarrativeCapability {
  /**
   * 基于决策追踪生成叙事
   */
  public generate(trace: DecisionTrace): NarrativeFragment {
    return {
      fragmentId: `nar-${trace.cycleId}`,
      summary: `Stelle decided to ${trace.selectedIntentId} after observing ${trace.observations.length} things.`,
      mood: "neutral",
      importance: 5,
    };
  }
}
