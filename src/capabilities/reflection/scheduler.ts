import type { MemoryEntry } from "../self_memory/schema.js";
import { type ReflectionPolicy, DEFAULT_REFLECTION_POLICY } from "./policy.js";

/**
 * 反思任务 (Reflection Job)
 */
export interface ReflectionJob {
  jobId: string;
  agentId: string;
  trigger: "memory_count" | "importance_sum" | "session_end" | "negative_feedback" | "idle_time" | "debug_manual";
  memoryIds: string[];
}

/**
 * 反思调度器 (Reflection Scheduler)
 * 监控记忆变化并决定何时触发反思任务。
 */
export class ReflectionScheduler {
  private lastReflectionAt = 0;
  private newMemories: MemoryEntry[] = [];

  constructor(private readonly policy: ReflectionPolicy = DEFAULT_REFLECTION_POLICY) {}

  /**
   * 记录新增记忆并检查是否应触发反思
   */
  public onMemoryAdded(entry: MemoryEntry): ReflectionJob | null {
    this.newMemories.push(entry);

    const now = Date.now();
    const timeSinceLast = now - this.lastReflectionAt;

    if (timeSinceLast < this.policy.cooldownMs) {
      return null;
    }

    const importanceSum = this.newMemories.reduce((sum, m) => sum + m.importance, 0);

    if (
      this.newMemories.length >= this.policy.minNewMemories ||
      importanceSum >= this.policy.minImportanceSum
    ) {
      const job: ReflectionJob = {
        jobId: `ref-job-${Date.now()}`,
        agentId: entry.agentId,
        trigger: this.newMemories.length >= this.policy.minNewMemories ? "memory_count" : "importance_sum",
        memoryIds: this.newMemories.map((m) => m.memoryId),
      };

      this.newMemories = [];
      this.lastReflectionAt = now;
      return job;
    }

    return null;
  }
}
