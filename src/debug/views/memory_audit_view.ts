import type { MemoryEntry } from "../../capabilities/self_memory/schema.js";

/**
 * 记忆审计视图 (Memory Audit View)
 */
export class MemoryAuditView {
  public render(entry: MemoryEntry): string {
    const lines: string[] = [];
    lines.push(`Memory Entry: ${entry.memoryId}`);
    lines.push(`Kind: ${entry.kind}`);
    lines.push(`Scope: ${entry.scope}`);
    lines.push(`Importance: ${entry.importance}`);
    lines.push(`Summary: ${entry.summary}`);
    
    if (entry.evidenceRefs.length > 0) {
      lines.push("Evidence:");
      entry.evidenceRefs.forEach((ref) => {
        lines.push(`  - ${ref.kind}: ${ref.uri} (${ref.summary || "no summary"})`);
      });
    }

    return lines.join("\n");
  }
}
