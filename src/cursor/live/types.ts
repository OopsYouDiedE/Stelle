import { z } from "zod";
import type { NormalizedLiveEvent } from "../../utils/live_event.js";

export type LiveAction = "respond_to_crowd" | "respond_to_specific" | "drop_noise" | "generate_topic";
export type LiveEmotion = "neutral" | "happy" | "laughing" | "sad" | "surprised" | "thinking" | "teasing";

/**
 * 接口：直播批处理决策 (LLM 输出)
 */
export interface LiveBatchDecision {
  action: LiveAction;
  emotion: LiveEmotion;
  intensity: number; // 1-5
  script: string;
  reason: string;
  toolPlan?: {
    calls: Array<{ tool: string; parameters: Record<string, any> }>;
  };
}

/**
 * 接口：直播工具执行结果视图
 */
export interface LiveToolResultView {
  name: string;
  ok: boolean;
  summary: string;
  data?: any;
}

/**
 * 接口：语音队列项
 */
export interface LiveSpeechQueueItem {
  id: string;
  text: string;
  source: "topic" | "response";
  enqueuedAt: number;
  emotion: string;
}

/**
 * 配置：LiveCursor 专用
 */
export interface LiveCursorOptions {
  speechQueueLimit: number;
  bufferWindowMs: number;
  idleTopicIntervalMs: number;
}
