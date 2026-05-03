import type { MemoryEntry, MemoryWritePolicyResult } from "./schema.js";

/**
 * 记忆写入策略
 * 负责确定一条记忆是否应该被持久化到长期记忆，以及它的重要性。
 */
export class MemoryWritePolicy {
  private readonly longTermThreshold = 7;

  /**
   * 评估记忆条目并返回写入建议
   */
  public evaluate(entry: Partial<MemoryEntry>): MemoryWritePolicyResult {
    const reasons: string[] = [];
    let importance = entry.importance ?? 1;
    let shouldWriteLongTerm = false;
    let shouldWriteShortTerm = true;

    // 规则 1: 用户明确要求记住
    if (entry.summary?.toLowerCase().includes("user requested") || entry.kind === "preference") {
      shouldWriteLongTerm = true;
      importance = Math.max(importance, 9);
      reasons.push("Explicit user request or preference change detected.");
    }

    // 规则 2: 承诺创建
    if (entry.kind === "promise") {
      shouldWriteLongTerm = true;
      importance = Math.max(importance, 8);
      reasons.push("Promise created, tracking commitment.");
    }

    // 规则 3: 关系变化 (需要证据)
    if (entry.kind === "relationship") {
      if ((entry.evidenceRefs?.length ?? 0) >= 2) {
        shouldWriteLongTerm = true;
        reasons.push("Relationship change with sufficient evidence.");
      } else {
        reasons.push("Relationship mention without sufficient evidence for long-term storage.");
      }
    }

    // 规则 4: 普通片段 (基于重要性阈值)
    if (entry.kind === "episode") {
      if (importance >= this.longTermThreshold) {
        shouldWriteLongTerm = true;
        reasons.push(`High importance episode (score: ${importance}).`);
      } else {
        reasons.push("Ordinary episode, keeping in short-term only.");
      }
    }

    // 规则 5: 反思 (必须有证据)
    if (entry.kind === "reflection") {
      if ((entry.evidenceRefs?.length ?? 0) > 0) {
        shouldWriteLongTerm = true;
        reasons.push("Reflection with evidence links.");
      } else {
        shouldWriteLongTerm = false;
        reasons.push("Reflection rejected: missing evidence links.");
      }
    }

    return {
      shouldWriteShortTerm,
      shouldWriteLongTerm,
      importance,
      reasons,
    };
  }
}
