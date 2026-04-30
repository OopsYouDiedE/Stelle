# Topic Script Format

话题剧本是带 YAML frontmatter 的 Markdown 文件。Frontmatter 描述节目级元数据；正文用一级标题分隔 section，每个 section 用列表字段描述可执行内容。

## Frontmatter

必填字段：

- `script_id`
- `template_id`
- `title`
- `summary`
- `language`
- `scene`
- `phase_flow`
- `current_question`
- `target_duration_sec`
- `safe_topic_kinds`
- `excluded_topics`
- `memory_policy`
- `revision`
- `approval_status`

`approval_status` 取值为 `draft`、`reviewed`、`approved`、`archived`。

## Section

每个 section 必填：

- `section_id`
- `phase`
- `timestamp`
- `duration_sec`
- `goal`
- `host_script`
- `discussion_points`
- `question_prompts`
- `fallback_lines`
- `handoff_rule`

可选字段：

- `interaction_triggers`
- `fact_guardrails`
- `operator_notes`
- `lock_level`

`lock_level` 取值为 `locked`、`soft`、`system`，默认 `soft`。

## Example

```md
---
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
```
