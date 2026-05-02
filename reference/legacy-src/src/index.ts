/**
 * 模块：公开 API 出口
 *
 * 运行逻辑：
 * - 只暴露外部启动和测试需要的最小接口。
 * - Cursor 具体实现、prompt 组装和内部 runtime 细节不从这里批量导出。
 *
 * 主要导出：
 * - `start` / `startRuntime`：启动 Stelle。
 * - `ToolRegistry` / `createDefaultToolRegistry`：测试或外部宿主可复用的工具层。
 * - 少量类型：配置、记忆、Cursor snapshot、工具定义。
 */
export { start, startRuntime } from "./start.js";
export { createDefaultToolRegistry, ToolRegistry } from "./tool.js";

export type { StartMode, StelleApplication } from "./core/application.js";
export type { RuntimeStateSnapshot } from "./runtime_state.js";
export type { ToolAuthority, ToolContext, ToolDefinition, ToolResult } from "./tool.js";
export type { CursorSnapshot, StelleCursor } from "./cursor/types.js";
export type { RuntimeConfig } from "./config/index.js";
export type { MemoryStore } from "./memory/memory.js";
