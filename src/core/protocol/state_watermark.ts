/**
 * 状态版本水位 (State Watermark)
 * 用于在分布式/异步窗口间追踪数据一致性，确保认知是基于特定版本的状态做出的决策。
 */
export interface StateWatermark {
  /** 世界/上下文状态版本: { partitionId: version } */
  world?: Record<string, number>;
  /** 记忆状态版本: { scope: version } */
  memory?: Record<string, number>;
  /** 反思状态版本: { agentId: version } */
  reflection?: Record<string, number>;
  /** 配置状态版本: { configId: version } */
  config?: Record<string, number>;
}
