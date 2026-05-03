/**
 * 调试提供者 (Debug Provider) - Core 定义
 * 任何想要向 Debug 系统暴露状态或命令的组件都应实现此接口。
 */
export interface DebugProvider {
  id: string;
  ownerPackageId: string;
  /** 获取当前快照 */
  getSnapshot(): Record<string, unknown>;
  /** 获取可执行命令列表 */
  getCommands?(): DebugCommand[];
  /** 执行命令 */
  executeCommand?(commandId: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface DebugCommand {
  id: string;
  displayName: string;
  description?: string;
  paramsSchema?: any; // Zod schema or similar
}
