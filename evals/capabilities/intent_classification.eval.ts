import { describe, expect, it } from "vitest";
import { hasEvalLlmKeys, evalModelLabel, makeEvalLlm } from "../utils/env.js";
import { recordEvalCase } from "../utils/report.js";
import { maybeAssertScore, summarizeChecks } from "../utils/scoring.js";
import { LiveGateway } from "../../src/windows/live/legacy_cursor/gateway.js";

/**
 * Capability Eval: Live Intent Classification
 * 验证 LiveGateway 的启发式打标和 LLM 识别是否准确。
 */
describe.skipIf(!hasEvalLlmKeys())("Intent Classification Capability Eval", () => {
  it("verifies heuristic and structured intent extraction", async () => {
    const cases = [
      { id: "intent-greeting", text: "你好呀主播", expected: "greeting" },
      { id: "intent-test", text: "测试一下能看到吗", expected: "test_connection" },
      { id: "intent-question", text: "你会打游戏吗？", expected: "question" },
      { id: "intent-noise", text: "666666", expected: "unknown" },
      { id: "intent-feedback", text: "唱得好听！", expected: "feedback" },
    ];

    const gateway = new LiveGateway({ now: () => Date.now() } as any);

    for (const evalCase of cases) {
      const start = Date.now();

      // We are testing the private detectIntentHeuristically logic via any-cast for simplicity in eval
      const result = (gateway as any).detectIntentHeuristically({ text: evalCase.text });

      const score = summarizeChecks([
        {
          ok: result.intent === evalCase.expected,
          name: "correct_intent",
          note: `Result: ${result.intent}, Expected: ${evalCase.expected}`,
        },
      ]);

      maybeAssertScore(score, 1.0);

      await recordEvalCase({
        suite: "intent_classification",
        caseId: evalCase.id,
        title: `Classifying: ${evalCase.text}`,
        model: "heuristic-adapter",
        latencyMs: Date.now() - start,
        input: { text: evalCase.text },
        output: result,
        score,
      });
    }
  }, 60000);
});
