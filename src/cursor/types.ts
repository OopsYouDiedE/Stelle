/**
 * 模块：Cursor 共享类型
 *
 * 运行逻辑：
 * - Runtime 创建 Cursor 时注入 LLM、工具、配置、记忆和 EventBus。
 * - Cursor 只通过这些接口感知外部世界，不直接 import Runtime。
 *
 * 主要类型：
 * - `CursorContext`：Cursor 的依赖注入容器。
 * - `StelleEvent`：跨 Cursor / Core 的内部事件协议。
 * - `StelleCursor`：所有 Cursor 必须实现的最小接口。
 */
import type { LlmClient } from "../utils/llm.js";
import type { RuntimeConfig } from "../utils/config_loader.js";
import type { ToolRegistry } from "../tool.js";
import type { MemoryStore } from "../utils/memory.js";

export type CursorStatus = "idle" | "active" | "waiting" | "cooldown" | "error";

export interface CursorContext {
  llm: LlmClient;
  tools: ToolRegistry;
  config: RuntimeConfig;
  memory?: MemoryStore;
  publishEvent: (event: StelleEvent) => void;
  now: () => number;
}

export interface StelleEventBase {
  id?: string;
  timestamp?: number;
}

export type StelleEvent =
  | (StelleEventBase & {
      type: "live.request";
      source: "discord" | "debug" | "system";
      payload: { text: string; forceTopic?: boolean; [key: string]: unknown };
    })
  | (StelleEventBase & { type: "core.tick"; reason: string })
  | (StelleEventBase & { type: "live.tick"; reason: string })
  | (StelleEventBase & { type: "inner.tick"; reason: string })
  | (StelleEventBase & {
      type: "cursor.reflection";
      source: "discord" | "live";
      payload: {
        intent: string;
        summary: string;
        impactScore?: number; // 0-10
        emotion?: "neutral" | "positive" | "negative" | "tense" | "excited";
        salience?: "low" | "medium" | "high";
        [key: string]: unknown;
      };
    });

export interface CursorSnapshot {
  id: string;
  kind: string;
  status: CursorStatus;
  summary: string;
  state: Record<string, unknown>;
}

export interface StelleCursor {
  id: string;
  kind: string;
  displayName: string;
  snapshot(): CursorSnapshot;
}
