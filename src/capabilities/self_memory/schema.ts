import type { EvidenceRef } from "../../core/protocol/data_ref.js";

/**
 * 记忆条目 (Memory Entry)
 */
export interface MemoryEntry {
  memoryId: string;
  agentId: string;
  /** 记忆作用域 */
  scope: "self" | "session" | "relationship" | "world";
  /** 记忆种类 */
  kind: "episode" | "preference" | "promise" | "relationship" | "reflection" | "self_belief";
  /** 简短总结 */
  summary: string;
  /** 详细内容 (可选) */
  detail?: string;
  /** 重要性评分 (1-10) */
  importance: number;
  /** 支撑证据的事件或引用列表 */
  evidenceRefs: EvidenceRef[];
  /** 创建时间 (ISO-8601) */
  createdAt: string;
  /** 状态 */
  status: "raw" | "consolidated" | "superseded";
}

/**
 * 记忆写入策略结果
 */
export interface MemoryWritePolicyResult {
  /** 是否写入短期/工作记忆 */
  shouldWriteShortTerm: boolean;
  /** 是否写入长期记忆 */
  shouldWriteLongTerm: boolean;
  /** 最终计算的重要性评分 */
  importance: number;
  /** 策略决策理由 */
  reasons: string[];
}
