import { describe, expect, it } from "vitest";
import { getProgramTemplate } from "../../src/live/controller/templates.js";
import { compileTopicScriptDraft } from "../../src/live/controller/topic_script_compiler.js";
import { TopicScriptDraftSchema, type TopicScriptDraft } from "../../src/live/controller/topic_script_schema.js";
import { loadEvalCases } from "../utils/dataset.js";
import { evalModelLabel, hasEvalLlmKeys, makeEvalLlm } from "../utils/env.js";
import { recordEvalCase } from "../utils/report.js";
import { forbiddenStrings, maybeAssertScore, requiredFields, summarizeChecks } from "../utils/scoring.js";

describe.skipIf(!hasEvalLlmKeys())("Topic Script Generation LLM Eval", () => {
  it("generates schema-valid and compilable topic script drafts", async () => {
    const cases = await loadEvalCases("topic_script_generation.llm.jsonl");
    const llm = makeEvalLlm();

    for (const evalCase of cases) {
      const start = Date.now();
      const template = getProgramTemplate(String(evalCase.input.templateId));
      const fallback = fallbackDraft(
        template.id,
        String(evalCase.input.title ?? template.title),
        String(evalCase.input.topic ?? template.title),
      );
      const result = await llm.generateJson(
        [
          "Generate a Stelle topic script draft as JSON only.",
          "The script must be safe for live streaming and must not call live tools.",
          "Return the same JSON keys as this example and include at least 3 sections:",
          JSON.stringify(fallback, null, 2),
          "Context:",
          JSON.stringify(evalCase.input, null, 2),
        ].join("\n\n"),
        "topic_script_generation_eval",
        (raw) => TopicScriptDraftSchema.parse({ ...fallback, ...(raw as Record<string, unknown>) }),
        { role: "primary", temperature: 0.3, maxOutputTokens: 8192 },
      );
      const compiled = compileTopicScriptDraft(result);
      const expected = evalCase.expected as Record<string, unknown>;
      const score = summarizeChecks([
        ...requiredFields(result as unknown as Record<string, unknown>, [
          "script_id",
          "template_id",
          "title",
          "sections",
        ]),
        { ok: result.template_id === expected.templateId, name: "template_id", note: `template=${result.template_id}` },
        {
          ok: result.sections.length >= Number(expected.minSections ?? 3),
          name: "min_sections",
          note: `sections=${result.sections.length}`,
        },
        { ok: compiled.sections.length === result.sections.length, name: "compiler_round_trip" },
        forbiddenStrings(JSON.stringify(result), expected.forbiddenStrings, "topic_script_generation"),
      ]);

      maybeAssertScore(score, 0.85);
      await recordEvalCase({
        suite: "topic_script_generation",
        caseId: evalCase.id,
        title: evalCase.title,
        model: evalModelLabel(),
        latencyMs: Date.now() - start,
        input: evalCase.input,
        output: { result, compiledSections: compiled.sections.length },
        score,
      });
      expect(score.score).toBeGreaterThanOrEqual(0.85);
    }
  }, 240000);
});

function fallbackDraft(templateId: string, title: string, topic: string): TopicScriptDraft {
  const template = getProgramTemplate(templateId);
  return {
    script_id: `eval_${template.id}`,
    template_id: template.id,
    title,
    summary: `围绕${topic}的直播话题剧本。`,
    language: "zh-CN",
    scene: template.mode,
    phase_flow: template.phaseFlow,
    current_question: topic,
    next_question: "你会怎么选？",
    target_duration_sec: 600,
    safe_topic_kinds: template.safeTopicKinds,
    excluded_topics: template.excludedTopics,
    memory_policy: template.memoryPolicy,
    generated_by: "eval",
    prompt_version: "eval-v1",
    revision: 1,
    approval_status: "draft",
    metadata: {},
    sections: template.phaseFlow.slice(0, 3).map((phase, index) => ({
      section_id: `${phase}_${index + 1}`,
      phase,
      timestamp: `0${index}:00`,
      duration_sec: 90,
      goal: `推进${phase}阶段`,
      host_script: `我们继续聊${topic}。`,
      discussion_points: ["节目边界", "观众问题", "安全回退"],
      question_prompts: [topic],
      interaction_triggers: ["观众提问时先回应"],
      fact_guardrails: template.excludedTopics.map((item) => `避免${item}`),
      fallback_lines: ["这部分先收束到低风险范围。"],
      handoff_rule: "收集观点后进入下一段",
      lock_level: "soft",
    })),
  };
}
