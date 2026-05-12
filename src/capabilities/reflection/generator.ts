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

const VALID_REFLECTION_CATEGORIES = new Set<ReflectionInsight["category"]>([
  "self",
  "relationship",
  "preference",
  "goal",
]);

/**
 * 反思生成器 (Reflection Generator)
 */
export class ReflectionGenerator {
  constructor(private readonly llm?: LlmClient) {}

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
Return ONLY a JSON array. Every object must include:
- insightId: unique string
- summary: concise insight
- category: "self" | "relationship" | "preference" | "goal"
- confidence: number from 0 to 1
- evidenceMemoryIds: array of memory IDs from the input list
`;

    try {
      if (!this.llm) return [createFallbackInsight(job)];
      return await this.llm.generateJson<ReflectionInsight[]>(
        prompt,
        "ReflectionInsight[]",
        (raw) => {
          const items: unknown[] = Array.isArray(raw)
            ? raw
            : Array.isArray((raw as any)?.insights)
              ? (raw as any).insights
              : Array.isArray((raw as any)?.reflectionInsights)
                ? (raw as any).reflectionInsights
                : (() => {
                    throw new Error("Expected array");
                  })();
          return items.map((item, index) => ReflectionInsightSchema.parse(normalizeInsight(item, job, index)));
        },
        { role: "secondary", temperature: 0.3 }
      );
    } catch (error) {
      console.error("[ReflectionGenerator] LLM failed to generate insights.", error);
      return [createFallbackInsight(job)];
    }
  }
}

function normalizeInsight(raw: unknown, job: ReflectionJob, index: number): ReflectionInsight {
  const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const confidence = typeof item.confidence === "number" ? item.confidence : Number(item.confidence);

  return {
    insightId: coerceString(item.insightId ?? item.id, `${job.jobId}-insight-${index + 1}`),
    summary: coerceString(
      item.summary ?? item.insight ?? item.description,
      "Recent memories suggest a recurring pattern worth carrying forward.",
    ),
    category: coerceCategory(item.category),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.6,
    evidenceMemoryIds: Array.isArray(item.evidenceMemoryIds)
      ? item.evidenceMemoryIds.map((id) => String(id))
      : job.memoryIds,
  };
}

function createFallbackInsight(job: ReflectionJob): ReflectionInsight {
  return {
    insightId: `${job.jobId}-fallback-insight`,
    summary: `Recent memories suggest a recurring pattern worth carrying forward.`,
    category: "preference",
    confidence: 0.6,
    evidenceMemoryIds: job.memoryIds,
  };
}

function coerceString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function coerceCategory(value: unknown): ReflectionInsight["category"] {
  return typeof value === "string" && VALID_REFLECTION_CATEGORIES.has(value as ReflectionInsight["category"])
    ? (value as ReflectionInsight["category"])
    : "preference";
}
