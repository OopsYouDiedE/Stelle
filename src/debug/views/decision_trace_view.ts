import type { DecisionTrace } from "../../core/execution/cycle_journal.js";

/**
 * 决策追踪视图 (Decision Trace View)
 * 用于可视化展示一个决策循环的完整路径。
 */
export class DecisionTraceView {
  public render(trace: DecisionTrace): string {
    const lines: string[] = [];
    lines.push(`Decision Trace: ${trace.cycleId}`);
    lines.push(`Correlation ID: ${trace.correlationId}`);
    lines.push(`Status: ${trace.status}`);
    lines.push(`Started At: ${trace.startedAt}`);
    lines.push(`Actor: ${trace.actorId}`);
    lines.push(`Observations: ${trace.observations.length}`);
    lines.push(`Memory Hits: ${trace.memoryHits.length}`);
    lines.push(`Selected Intent: ${trace.selectedIntentId || "None"}`);
    
    if (trace.actionResultIds) {
      lines.push(`Actions: ${trace.actionResultIds.join(", ")}`);
    }
    
    if (trace.memoryWriteIds) {
      lines.push(`Memories Written: ${trace.memoryWriteIds.join(", ")}`);
    }

    return lines.join("\n");
  }
}
