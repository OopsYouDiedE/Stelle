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
import type { StelleEventBus } from "../utils/event_bus.js";
import type { StelleEvent } from "../utils/event_schema.js";
import type { StageOutputArbiter } from "../stage/output_arbiter.js";
import type { DeviceActionArbiter } from "../device/action_arbiter.js";

export type { StelleEvent };

export type CursorStatus = "idle" | "active" | "waiting" | "cooldown" | "error";

export interface CursorContext {
  llm: LlmClient;
  tools: ToolRegistry;
  config: RuntimeConfig;
  memory?: MemoryStore;
  eventBus: StelleEventBus;
  stageOutput: StageOutputArbiter;
  deviceAction?: DeviceActionArbiter;
  now: () => number;
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
  initialize?(): Promise<void>;
  stop?(): Promise<void>;
  handleEvent?(event: StelleEvent): Promise<void>;
  snapshot(): CursorSnapshot;
}
