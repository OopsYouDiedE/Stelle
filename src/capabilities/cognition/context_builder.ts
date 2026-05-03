import type { CognitiveContext } from "./schemas.js";
import type { StateWatermark } from "../../core/protocol/state_watermark.js";

/**
 * 认知上下文构建器 (Cognitive Context Builder)
 * 负责聚合观察事实、检索记忆和当前状态版本。
 */
export class ContextBuilder {
  /**
   * 构建认知上下文
   */
  public build(input: {
    cycleId: string;
    agentId: string;
    lane: "reply" | "proactive" | "world" | "stage";
    observations: any[];
    memoryHits: any[];
    worldView?: any;
    watermarks: StateWatermark;
  }): CognitiveContext {
    return {
      cycleId: input.cycleId,
      agentId: input.agentId,
      lane: input.lane,
      observations: input.observations,
      memoryHits: input.memoryHits,
      worldView: input.worldView,
      watermarks: input.watermarks,
    };
  }
}
