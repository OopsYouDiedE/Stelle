import type { MemoryEntry, MemoryWritePolicyResult } from "./schema.js";
import { MemoryWritePolicy } from "./write_policy.js";
import { MemoryAudit } from "./audit.js";

export interface MemoryRetrieveInput {
  agentId: string;
  query: string;
  limit?: number;
  watermark?: number;
}

export interface SelfMemoryApi {
  /**
   * 写入记忆
   */
  write(entry: Partial<MemoryEntry>): Promise<{ 
    memoryId: string; 
    policyResult: MemoryWritePolicyResult 
  }>;

  /**
   * 检索记忆
   */
  retrieve(input: MemoryRetrieveInput): Promise<MemoryEntry[]>;
}

export class SelfMemoryCapability implements SelfMemoryApi {
  private readonly policy = new MemoryWritePolicy();
  private readonly audit = new MemoryAudit();
  private readonly storage: MemoryEntry[] = [];

  public async write(entry: Partial<MemoryEntry>): Promise<{ memoryId: string; policyResult: MemoryWritePolicyResult }> {
    const memoryId = entry.memoryId || `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const fullEntry: MemoryEntry = {
      memoryId,
      agentId: entry.agentId || "stelle",
      scope: entry.scope || "session",
      kind: entry.kind || "episode",
      summary: entry.summary || "",
      importance: entry.importance || 1,
      evidenceRefs: entry.evidenceRefs || [],
      createdAt: new Date().toISOString(),
      status: "raw",
      ...entry,
    };

    const policyResult = this.policy.evaluate(fullEntry);
    
    if (this.audit.validate(fullEntry)) {
      this.audit.logAudit(memoryId, fullEntry.evidenceRefs);
      this.storage.push(fullEntry);
    }

    return { memoryId, policyResult };
  }

  public async retrieve(input: MemoryRetrieveInput): Promise<MemoryEntry[]> {
    // Simple filter-based retrieval for MVP
    const queryLower = input.query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2); // 忽略太短的词

    const results = this.storage.filter(m => {
      if (m.agentId !== input.agentId) return false;
      
      // 如果查询包含 "reflection" 或 "past"，匹配所有 reflection
      if (queryLower.includes("reflection") || queryLower.includes("past") || queryLower.includes("consolidated")) {
        if (m.kind === "reflection") return true;
      }

      // 如果没有关键词，或者匹配到 summary/kind
      if (queryWords.length === 0) return true;
      
      return queryWords.some(word => 
        m.summary.toLowerCase().includes(word) || 
        m.kind.toLowerCase().includes(word)
      );
    });

    return results.slice(0, input.limit || 10);
  }
}
