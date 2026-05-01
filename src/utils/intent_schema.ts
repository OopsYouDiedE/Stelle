// === Imports ===
import { z } from "zod";

// === Types & Interfaces ===
export type LiveEventIntent = z.infer<typeof LiveEventIntentSchema>;

export interface LiveEventMetadata {
  intent?: LiveEventIntent;
  confidence?: number;
  entities?: string[];
  [key: string]: unknown;
}

// === Core Logic ===

/**
 * 意图分类 Schema
 * 用于取代正则匹配，由 LLM 或启发式适配器生成。
 */
export const LiveEventIntentSchema = z.enum([
  "greeting", // 打招呼 (你好, hello)
  "test_connection", // 测试连接 (能看到吗, 测试)
  "question", // 提问 (为什么, 怎么做)
  "feedback", // 反馈/评论 (好听, 哈哈)
  "command", // 指令 (切换场景, 播放音乐)
  "unknown", // 未知/杂音
]);

// === Helpers ===
