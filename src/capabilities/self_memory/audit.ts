import type { MemoryEntry } from "./schema.js";
import type { EvidenceRef } from "../../core/protocol/data_ref.js";

/**
 * 记忆审计 (Memory Audit)
 * 负责追踪记忆的来源和证据链。
 */
export class MemoryAudit {
  /**
   * 记录记忆的审计轨迹
   */
  public logAudit(memoryId: string, evidenceRefs: EvidenceRef[]): void {
    console.log(`[MemoryAudit] Memory ${memoryId} created with ${evidenceRefs.length} evidence links.`);
    evidenceRefs.forEach((ref) => {
      console.log(`  - Evidence: ${ref.kind} @ ${ref.uri} (${ref.summary || "no summary"})`);
    });
  }

  /**
   * 验证记忆条目是否包含合法的证据
   */
  public validate(entry: MemoryEntry): boolean {
    if (entry.kind === "reflection" && entry.evidenceRefs.length === 0) {
      return false;
    }
    return true;
  }
}
