import type { StateWatermark } from "../protocol/state_watermark.js";
import type { EvidenceRef } from "../protocol/data_ref.js";

/**
 * 决策循环 (Decision Cycle)
 * 代表 Stelle 的一次完整主观思维过程。
 */
export interface DecisionCycle {
  cycleId: string;
  /** 执行决策的主体 (Agent) ID */
  agentId: string;
  /** 决策领域/赛道 */
  lane: "reply" | "proactive" | "world" | "stage";
  /** 关联追踪 ID */
  correlationId: string;
  /** 循环状态 */
  status: "created" | "running" | "blocked" | "completed" | "failed" | "cancelled";
  /** 开始时间 (ISO-8601) */
  startedAt: string;
  /** 完成时间 (ISO-8601) */
  completedAt?: string;
  /** 开始时的版本水位 */
  watermarks: StateWatermark;
}

/**
 * 决策追踪 (Decision Trace)
 * 记录决策过程中的详细信息，用于可解释性和 Debug。
 */
export interface DecisionTrace {
  cycleId: string;
  correlationId: string;
  actorId: string;
  startedAt: string;
  /** 追踪到的状态水位 */
  watermarks: StateWatermark;
  
  /** 观察到的事实 */
  observations: EvidenceRef[];
  /** 检索到的记忆 */
  memoryHits: EvidenceRef[];
  
  /** 候选意图 ID 列表 */
  candidateIntentIds: string[];
  /** 最终选中的意图 ID */
  selectedIntentId?: string;
  /** 决策打分详情 */
  scoreBreakdown?: Record<string, number>;
  
  /** 产生的执行计划 ID (如有) */
  planId?: string;
  /** 动作执行结果 ID 列表 */
  actionResultIds?: string[];
  /** 写入的记忆 ID 列表 */
  memoryWriteIds?: string[];
  /** 产生的反思 ID 列表 */
  reflectionIds?: string[];
  
  status: "running" | "completed" | "failed" | "cancelled";
}
