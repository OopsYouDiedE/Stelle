/**
 * 窗口实例 (Window Instance)
 * 定义运行时窗口的元数据和生命周期状态。
 */
export interface WindowInstance {
  instanceId: string;
  packageId: string;
  displayName: string;
  status: "starting" | "running" | "suspended" | "stopping" | "stopped";
  startedAt: string;
  config: Record<string, unknown>;
}
