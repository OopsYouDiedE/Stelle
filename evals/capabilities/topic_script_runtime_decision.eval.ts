import { describe, expect, it } from "vitest";
import { TopicScriptRuntimeDecisionSchema, topicScriptRuntimeDecisionValues } from "../../src/live/program/topic_script_schema.js";
import { loadEvalCases } from "../utils/dataset.js";
import { evalModelLabel, hasEvalLlmKeys, makeEvalLlm } from "../utils/env.js";
import { recordEvalCase } from "../utils/report.js";
import { enumField, forbiddenStrings, maybeAssertScore, requiredFields, summarizeChecks } from "../utils/scoring.js";

describe.skipIf(!hasEvalLlmKeys())("Topic Script Runtime Decision LLM Eval", () => {
  it("routes online signals without live tool calls", async () => {
    const cases = await loadEvalCases("topic_script_runtime_decision.llm.jsonl");
    const llm = makeEvalLlm();

    for (const evalCase of cases) {
      const start = Date.now();
      const result = await llm.generateJson(
        [
          "You are Stelle's topic script runtime decision layer.",
          "Return JSON only. Never call live tools. StageOutputArbiter owns visible output.",
          "Valid actions: continue_section, answer_question, use_fallback, request_patch, human_review.",
          "Direct viewer questions should normally answer_question. Privacy or high-risk content should use_fallback or human_review.",
          "Schema:",
          JSON.stringify({ action: "answer_question", section_id: "section id", text: "short speakable text", reason: "short reason", priority: 70 }),
          "Input:",
          JSON.stringify(evalCase.input, null, 2),
        ].join("\n\n"),
        "topic_script_runtime_decision_eval",
        raw => TopicScriptRuntimeDecisionSchema.parse(raw),
        { role: "primary", temperature: 0.1, maxOutputTokens: 2048 }
      );
      const expected = evalCase.expected as Record<string, unknown>;
      const allowed = Array.isArray(expected.allowedActions) ? expected.allowedActions.map(String) : [String(expected.action)];
      const score = summarizeChecks([
        ...requiredFields(result as unknown as Record<string, unknown>, ["action", "text", "reason", "priority"]),
        enumField(result as unknown as Record<string, unknown>, "action", topicScriptRuntimeDecisionValues),
        { ok: allowed.includes(result.action), name: "expected_action", note: `action=${result.action}; allowed=${allowed.join(",")}` },
        forbiddenStrings(JSON.stringify(result), expected.forbiddenStrings, "topic_script_runtime_decision"),
      ]);

      maybeAssertScore(score, 0.85);
      await recordEvalCase({
        suite: "topic_script_runtime_decision",
        caseId: evalCase.id,
        title: evalCase.title,
        model: evalModelLabel(),
        latencyMs: Date.now() - start,
        input: evalCase.input,
        output: result,
        score,
      });
      expect(score.score).toBeGreaterThanOrEqual(0.85);
    }
  }, 240000);
});
