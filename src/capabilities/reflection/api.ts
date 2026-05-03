import { ReflectionScheduler, type ReflectionJob } from "./scheduler.js";
import { ReflectionGenerator, type ReflectionInsight } from "./generator.js";
import type { MemoryEntry } from "../self_memory/schema.js";
import type { LlmClient } from "../model/llm.js";

export interface ReflectionApi {
  process_memory(entry: MemoryEntry): Promise<ReflectionInsight[]>;
  manual_reflect(memoryIds: string[]): Promise<ReflectionInsight[]>;
}

export class ReflectionCapability implements ReflectionApi {
  private readonly scheduler = new ReflectionScheduler();
  private readonly generator: ReflectionGenerator;

  constructor(llm: LlmClient) {
    this.generator = new ReflectionGenerator(llm);
  }

  public async process_memory(entry: MemoryEntry): Promise<ReflectionInsight[]> {
    const job = this.scheduler.onMemoryAdded(entry);
    if (job) {
      return this.generator.generate(job);
    }
    return [];
  }

  public async manual_reflect(memoryIds: string[]): Promise<ReflectionInsight[]> {
    const job: ReflectionJob = {
      jobId: `ref-manual-${Date.now()}`,
      agentId: "stelle",
      trigger: "debug_manual",
      memoryIds,
    };
    return this.generator.generate(job);
  }
}
