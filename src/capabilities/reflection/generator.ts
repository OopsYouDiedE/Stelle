import type { ReflectionJob } from "./scheduler.js";
import type { LlmClient } from "../model/llm.js";
import { z } from "zod";

/**
 * 反思见解 (Reflection Insight)
 */
export interface ReflectionInsight {
  insightId: string;
  summary: string;
  category: "self" | "relationship" | "preference" | "goal";
  confidence: number;
  /** 关联的证据记忆 ID 列表 */
  evidenceMemoryIds: string[];
}

const ReflectionInsightSchema = z.object({
  insightId: z.string(),
  summary: z.string(),
  category: z.enum(["self", "relationship", "preference", "goal"]),
  confidence: z.number().min(0).max(1),
  evidenceMemoryIds: z.array(z.string()),
});

/**
 * 反思生成器 (Reflection Generator)
 */
export class ReflectionGenerator {
  constructor(private readonly llm: LlmClient) {}

  /**
   * 生成反思见解
   */
  public async generate(job: ReflectionJob): Promise<ReflectionInsight[]> {
    const prompt = `
You are the reflection engine of Stelle, an AI agent.
Your task is to consolidate a group of recent memories into high-level insights.

### Memories to Consolidate:
${JSON.stringify(job.memoryIds)}

### Requirements:
1. Identify patterns in user preferences, relationship changes, or self-beliefs.
2. Generate 1-2 Reflection Insights.
3. Each insight must link back to the evidence memory IDs provided.

### Output Format:
Return a JSON array of objects matching the ReflectionInsight schema.
`;

    try {
      return await this.llm.generateJson<ReflectionInsight[]>(
        prompt,
        "ReflectionInsight[]",
        (raw) => {
          if (!Array.isArray(raw)) throw new Error("Expected array");
          return raw.map(r => ReflectionInsightSchema.parse(r));
        },
        { role: "secondary", temperature: 0.3 }
      );
    } catch (error) {
      console.error("[ReflectionGenerator] LLM failed to generate insights.", error);
      return [];
    }
  }
}
