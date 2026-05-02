import { describe, expect, it } from "vitest";
import {
  compileTopicScriptDraft,
  compileTopicScriptMarkdown,
  TopicScriptCompileError,
} from "../../src/capabilities/program/topic_script/compiler.js";
import type { TopicScriptDraft } from "../../src/capabilities/program/topic_script/topic_script_schema.js";

describe("topic script compiler", () => {
  it("compiles markdown frontmatter and sections into runtime AST", () => {
    const result = compileTopicScriptMarkdown(exampleMarkdown());

    expect(result.draft.script_id).toBe("ts_ai_memory_v1");
    expect(result.compiled.scriptId).toBe("ts_ai_memory_v1");
    expect(result.compiled.sections[0]?.id).toBe("opening_hook");
    expect(result.compiled.sections[0]?.startOffsetSec).toBe(0);
    expect(result.compiled.sections[0]?.softLines[0]).toContain("AI 主播记住观众");
    expect(result.compiled.sections[0]?.fallbackLines).toContain("我们先聊原则，不收集个人隐私。");
  });

  it("rejects duplicate section ids", () => {
    const draft = validDraft();
    draft.sections.push({ ...draft.sections[0]! });

    expect(() => compileTopicScriptDraft(draft)).toThrow(TopicScriptCompileError);
  });

  it("protects locked host lines in compiled output", () => {
    const draft = validDraft();
    draft.sections[0]!.lock_level = "locked";
    const compiled = compileTopicScriptDraft(draft);

    expect(compiled.sections[0]?.lockedLines).toEqual([draft.sections[0]!.host_script]);
    expect(compiled.sections[0]?.softLines).not.toContain(draft.sections[0]!.host_script);
  });
});

function validDraft(): TopicScriptDraft {
  return compileTopicScriptMarkdown(exampleMarkdown()).draft;
}

function exampleMarkdown(): string {
  return `---
script_id: ts_ai_memory_v1
template_id: ai_reflection
title: AI 主播该不该记住观众
summary: 讨论记忆边界与撤回权。
language: zh-CN
scene: reflection
phase_flow:
  - opening
  - sampling
  - summarizing
  - closing
current_question: 你希望 AI 主播记住你吗？
next_question: 如果记忆可撤回，你会更能接受吗？
target_duration_sec: 600
safe_topic_kinds:
  - 行为策略
  - 节目复盘
excluded_topics:
  - 政治
  - 医疗诊断
memory_policy: public_episode_summary
revision: 1
approval_status: draft
metadata:
  seed: smoke
---

# opening_hook
- section_id: opening_hook
- phase: opening
- timestamp: 00:00
- duration_sec: 90
- goal: 抛出核心问题。
- host_script: 今天聊一个边界问题：AI 主播记住观众，到底是熟悉还是越界？
- discussion_points:
  - 记忆带来连贯感
  - 记忆也带来边界焦虑
- question_prompts:
  - 你希望被记住吗？
- interaction_triggers:
  - 如果弹幕沉默，追加投票式问题
- fact_guardrails:
  - 不声称当前系统已经拥有真实个体长期记忆
- fallback_lines:
  - 我们先聊原则，不收集个人隐私。
- handoff_rule: 收到至少 3 条观点或超时
- lock_level: soft
`;
}
