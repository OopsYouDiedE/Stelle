import { z } from "zod";
import type { CognitiveContext, CandidateIntent } from "./schemas.js";
import { CandidateIntentSchema } from "./schemas.js";
import type { LlmClient } from "../model/llm.js";

/**
 * 意图生成器 (Intent Generator)
 * 核心认知逻辑，根据上下文产生候选意图。
 */
export class IntentGenerator {
  constructor(private readonly llm: LlmClient) {}

  /**
   * 生成候选意图
   */
  public async generate(ctx: CognitiveContext): Promise<CandidateIntent[]> {
    const prompt = `
You are the cognitive engine of Stelle, an AI agent.
Based on the current observations, memories, and world state, generate a list of Candidate Intents for your next actions.

### Context:
- Lane: ${ctx.lane}
- Observations: ${JSON.stringify(ctx.observations)}
- Retrieved Memories: ${JSON.stringify(ctx.memoryHits)}
- World View: ${JSON.stringify(ctx.worldView)}

### Requirements:
1. Generate 2-4 distinct Candidate Intents.
2. Each intent must have a scope: "reply", "world", "stage", "memory", or "tool".
3. Provide a clear justification based on the evidence provided.
4. Ensure the desiredOutcome describes the state change you want to achieve.

### Output Format:
Return a JSON array of objects matching the CandidateIntent schema.
`;

    try {
      const intents = await this.llm.generateJson<CandidateIntent[]>(
        prompt,
        "CandidateIntent[]",
        (raw) => {
          if (!Array.isArray(raw)) throw new Error("Expected array of intents");
          return raw.map(r => CandidateIntentSchema.parse(r));
        },
        { role: "primary", temperature: 0.7 }
      );
      return intents;
    } catch (error) {
      console.error("[IntentGenerator] LLM failed to generate intents, falling back to basic reply.", error);
      return [{
        intentId: `fallback-reply-${ctx.cycleId}`,
        actorId: ctx.agentId,
        scope: "reply",
        summary: "Standard reply due to cognitive failure",
        desiredOutcome: "User receives a basic response",
        evidenceRefs: [],
        justification: "System fallback triggered."
      }];
    }
  }
}

