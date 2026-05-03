/**
 * 因果追踪 (Causal Trace)
 * 用于在异步事件流中追踪行为的起源、关联和触发链条。
 */
export interface CausalTrace {
  /** 决策循环 ID (如有) */
  cycleId?: string;
  /** 关联 ID (透传，用于跨系统追踪) */
  correlationId: string;
  /** 因果 ID (指向上一个触发本事件的事件 ID) */
  causationId?: string;
}
