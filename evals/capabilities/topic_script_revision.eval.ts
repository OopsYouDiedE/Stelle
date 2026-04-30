import { describe, expect, it } from "vitest";
import { TopicScriptService } from "../../src/live/program/topic_script_service.js";
import type { TopicScriptDraft } from "../../src/live/program/topic_script_schema.js";
import { compileTopicScriptDraft } from "../../src/live/program/topic_script_compiler.js";
import { loadEvalCases } from "../utils/dataset.js";
import { evalModelLabel, hasEvalLlmKeys, makeEvalLlm } from "../utils/env.js";
import { recordEvalCase } from "../utils/report.js";
import { forbiddenStrings, maybeAssertScore, summarizeChecks } from "../utils/scoring.js";

describe.skipIf(!hasEvalLlmKeys())("Topic Script Revision LLM Eval", () => {
  it("revises soft sections while preserving locked lines", async () => {
    const cases = await loadEvalCases("topic_script_revision.llm.jsonl");
    const service = new TopicScriptService({ llm: makeEvalLlm(), now: () => 1000 });

    for (const evalCase of cases) {
      const start = Date.now();
      const draft = baseDraft();
      const expected = evalCase.expected as Record<string, unknown>;
      const input = evalCase.input as Record<string, unknown>;
      const revised = await service.reviseSection({
        draft,
        sectionId: String(expected.sectionId),
        viewerSignal: String(input.viewerSignal ?? ""),
        factCorrection: typeof input.factCorrection === "string" ? input.factCorrection : undefined,
      });
      const compiled = compileTopicScriptDraft(revised);
      const revisedSection = revised.sections.find(section => section.section_id === expected.sectionId);
      const speakableText = JSON.stringify({
        host_script: revisedSection?.host_script,
        discussion_points: revisedSection?.discussion_points,
        question_prompts: revisedSection?.question_prompts,
        fallback_lines: revisedSection?.fallback_lines,
        handoff_rule: revisedSection?.handoff_rule,
      });
      const score = summarizeChecks([
        { ok: revised.sections[0]?.host_script === expected.lockedText, name: "locked_line_preserved" },
        { ok: revised.revision === draft.revision + 1, name: "revision_incremented", note: `revision=${revised.revision}` },
        { ok: compiled.sections.length === revised.sections.length, name: "compiler_round_trip" },
        forbiddenStrings(speakableText, expected.forbiddenStrings, "topic_script_revision_speakable"),
      ]);

      maybeAssertScore(score, 0.85);
      await recordEvalCase({
        suite: "topic_script_revision",
        caseId: evalCase.id,
        title: evalCase.title,
        model: evalModelLabel(),
        latencyMs: Date.now() - start,
        input: evalCase.input,
        output: revised,
        score,
      });
      expect(score.score).toBeGreaterThanOrEqual(0.85);
    }
  }, 240000);
});

function baseDraft(): TopicScriptDraft {
  return {
    script_id: "eval_revision",
    template_id: "ai_reflection",
    title: "AI 记忆边界",
    summary: "测试局部修订。",
    language: "zh-CN",
    scene: "reflection",
    phase_flow: ["opening", "sampling", "summarizing", "closing"],
    current_question: "AI 主播该不该记住观众？",
    next_question: "撤回权应该怎么设计？",
    target_duration_sec: 480,
    safe_topic_kinds: ["行为策略", "节目复盘"],
    excluded_topics: ["政治", "医疗诊断", "法律判断", "金融投资", "隐私爆料"],
    memory_policy: "public_episode_summary",
    revision: 1,
    approval_status: "approved",
    metadata: {},
    sections: [
      {
        section_id: "opening_1",
        phase: "opening",
        timestamp: "00:00",
        duration_sec: 60,
        goal: "锁定开场",
        host_script: "开场锁定行不能改。",
        discussion_points: ["只做开场"],
        question_prompts: ["你想被记住吗？"],
        interaction_triggers: [],
        fact_guardrails: ["不声称真实长期个体记忆"],
        fallback_lines: ["先不聊隐私细节。"],
        handoff_rule: "进入采样",
        lock_level: "locked",
      },
      {
        section_id: "sampling_2",
        phase: "sampling",
        timestamp: "01:00",
        duration_sec: 120,
        goal: "采样观点",
        host_script: "我们听听支持、反对和条件接受三类观点。",
        discussion_points: ["支持方", "反对方", "条件接受方"],
        question_prompts: ["如果可以撤回，你能接受吗？"],
        interaction_triggers: ["遇到事实纠错时承认并修正"],
        fact_guardrails: ["不收集手机号、住址、身份证等隐私"],
        fallback_lines: ["我们只聊节目原则，不收集个人信息。"],
        handoff_rule: "收集三类观点后进入总结",
        lock_level: "soft",
      },
    ],
  };
}
