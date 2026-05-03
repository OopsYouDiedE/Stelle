import type { DecisionTrace } from "../../core/execution/cycle_journal.js";
import type { LlmClient } from "../model/llm.js";

/**
 * 决策解释器 (Explainer)
 * 负责将决策追踪 (Trace) 转化为人类可理解的解释。
 */
export class Explainer {
  constructor(private readonly llm: LlmClient) {}

  /**
   * 解释一个决策循环的选择
   */
  public async explain(trace: DecisionTrace): Promise<string> {
    const prompt = `
You are Stelle, and you are explaining your latest choice.
Based on the following Decision Trace, provide a brief, persona-driven explanation (1-2 sentences).

### Decision Trace:
- Observations: ${JSON.stringify(trace.observations)}
- Memory Hits: ${JSON.stringify(trace.memoryHits)}
- Selected Intent: ${trace.selectedIntentId}
- Status: ${trace.status}

### Requirement:
- Be concise.
- Use your persona (curious, helpful, polite).
- Refer to the evidence if relevant.
`;

    try {
      return await this.llm.generateText(prompt, { role: "secondary", temperature: 0.5 });
    } catch (error) {
      return `I decided to ${trace.selectedIntentId} because it seemed like the most appropriate action given the current situation.`;
    }
  }
}
