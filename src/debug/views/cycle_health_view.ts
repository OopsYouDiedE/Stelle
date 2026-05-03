import type { DecisionCycle } from "../../core/execution/cycle_journal.js";

/**
 * 循环健康视图 (Cycle Health View)
 * 用于监控决策循环的延迟和状态分布。
 */
export class CycleHealthView {
  public render(cycles: DecisionCycle[]): string {
    const lines: string[] = [];
    lines.push(`Cycle Health Summary (${cycles.length} cycles)`);
    
    const statusCounts = cycles.reduce((acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    lines.push(`Status: ${Object.entries(statusCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    
    // 简单模拟延迟计算
    const completed = cycles.filter(c => c.completedAt);
    if (completed.length > 0) {
      const avgLatency = completed.reduce((sum, c) => {
        const duration = new Date(c.completedAt!).getTime() - new Date(c.startedAt).getTime();
        return sum + duration;
      }, 0) / completed.length;
      lines.push(`Average Latency: ${avgLatency.toFixed(2)}ms`);
    }

    return lines.join("\n");
  }
}
