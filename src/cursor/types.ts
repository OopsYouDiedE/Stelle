/**
 * 模块：Cursor 共享类型
 *
 * 运行逻辑：
 * - Runtime 创建 Cursor 时注入 LLM、工具、配置、记忆和 dispatch。
 * - Cursor 只通过这些接口感知外部世界，不直接 import Runtime。
 *
 * 主要类型：
 * - `CursorContext`：Cursor 的依赖注入容器。
 * - `RuntimeDispatchEvent`：跨 Cursor / Core 的事件协议。
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
  dispatch?: (event: RuntimeDispatchEvent) => Promise<RuntimeDispatchResult>;
  now: () => number;
}

export type RuntimeDispatchEvent =
  | { type: "live_request"; source: "discord" | "debug" | "system"; payload: Record<string, unknown> }
  | { type: "core_tick"; reason: string };

export interface RuntimeDispatchResult {
  accepted: boolean;
  reason: string;
  eventId: string;
}

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
