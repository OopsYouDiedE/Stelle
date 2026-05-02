// === Imports ===
import type { LlmClient } from "../../model/llm.js";
import { getProgramTemplate } from "../stage_director/templates.js";
import { compileTopicScriptDraft } from "./compiler.js";
import type { TopicScriptDraft, TopicScriptSection } from "./topic_script_schema.js";
import { TopicScriptDraftSchema, TopicScriptSectionSchema } from "./topic_script_schema.js";
import { TopicScriptRepository, type TopicScriptRevisionRecord } from "./repository.js";

// === Types & Interfaces ===
export interface TopicScriptGenerationInput {
  templateId?: string;
  title?: string;
  topic?: string;
  episodeSummary?: string;
  publicMemories?: string[];
  targetDurationSec?: number;
  scriptId?: string;
  revision?: number;
}

export interface TopicScriptRevisionInput {
  draft: TopicScriptDraft;
  sectionId: string;
  viewerSignal: string;
  factCorrection?: string;
}

export interface TopicScriptServiceDeps {
  llm?: LlmClient;
  repository?: TopicScriptRepository;
  now?: () => number;
}

// === Main Class: TopicScriptService ===
export class TopicScriptService {
  readonly repository: TopicScriptRepository;
  private readonly now: () => number;

  constructor(private readonly deps: TopicScriptServiceDeps = {}) {
    this.repository = deps.repository ?? new TopicScriptRepository();
    this.now = deps.now ?? (() => Date.now());
  }

  // === Public API ===

  async generateDraft(
    input: TopicScriptGenerationInput,
    actor = "system",
  ): Promise<{ draft: TopicScriptDraft; record: TopicScriptRevisionRecord }> {
    const draft = await this.generateDraftObject(input);
    const record = await this.repository.saveDraft(draft, actor);
    return { draft, record };
  }

  async generateDraftObject(input: TopicScriptGenerationInput): Promise<TopicScriptDraft> {
    const template = getProgramTemplate(input.templateId);
    const fallback = buildFallbackDraft(input, this.now());
    if (!this.deps.llm) return fallback;

    try {
      const raw = await this.deps.llm.generateJson(
        buildGenerationPrompt(input, fallback),
        "topic_script_draft",
        (value) => normalizeDraft(value, fallback),
        { role: "primary", temperature: 0.4, maxOutputTokens: 8192, safeDefault: fallback },
      );
      const parsed = TopicScriptDraftSchema.parse({
        ...raw,
        template_id: template.id,
        scene: template.mode,
        safe_topic_kinds: template.safeTopicKinds,
        excluded_topics: template.excludedTopics,
        memory_policy: template.memoryPolicy,
      });
      compileTopicScriptDraft(parsed);
      return parsed;
    } catch (error) {
      console.warn(
        `[TopicScriptService] LLM draft generation failed; using fallback draft: ${error instanceof Error ? error.message : String(error)}`,
      );
      return fallback;
    }
  }

  async reviseSection(input: TopicScriptRevisionInput): Promise<TopicScriptDraft> {
    const section = input.draft.sections.find((item) => item.section_id === input.sectionId);
    if (!section) throw new Error(`Section not found: ${input.sectionId}`);
    if (section.lock_level === "locked") return input.draft;
    if (!this.deps.llm) return input.draft;

    const revised = await this.deps.llm.generateJson(
      buildRevisionPrompt(input, section),
      "topic_script_section_revision",
      (value) => normalizeSection(value, section),
      { role: "primary", temperature: 0.2, maxOutputTokens: 4096, safeDefault: section },
    );
    const nextSection = TopicScriptSectionSchema.parse({
      ...section,
      ...revised,
      section_id: section.section_id,
      phase: section.phase,
      timestamp: section.timestamp,
      duration_sec: section.duration_sec,
      lock_level: section.lock_level,
    });
    const nextDraft = {
      ...input.draft,
      revision: input.draft.revision + 1,
      approval_status: "draft" as const,
      sections: input.draft.sections.map((item) => (item.section_id === section.section_id ? nextSection : item)),
    };
    compileTopicScriptDraft(nextDraft);
    return nextDraft;
  }
}

// === Fallback Logic ===

function buildFallbackDraft(input: TopicScriptGenerationInput, now: number): TopicScriptDraft {
  const template = getProgramTemplate(input.templateId);
  const scriptId = input.scriptId ?? `ts_${template.id}_${now}`;
  const title = input.title ?? input.topic ?? template.title;
  const currentQuestion = input.topic ?? `今天围绕“${title}”先收集观众的真实看法。`;
  const phases = template.phaseFlow;
  const targetDurationSec = input.targetDurationSec ?? 600;
  const perSection = Math.max(60, Math.floor(targetDurationSec / phases.length));
  const sections = phases.map(
    (phase, index): TopicScriptSection => ({
      section_id: `${phase}_${index + 1}`,
      phase,
      timestamp: formatTimestamp(index * perSection),
      duration_sec: perSection,
      goal: phase === "opening" ? "抛出主题并邀请观众表态。" : `推进 ${phase} 阶段并保持可打断。`,
      host_script:
        index === 0
          ? `今天我们聊「${title}」。我会先抛问题，再根据弹幕分几类观点。`
          : `我们进入${phase}阶段，先把刚才的弹幕整理成可以继续讨论的问题。`,
      discussion_points: [`围绕${title}保持节目主线`, "优先回应明确问题", "避免高风险和个人隐私细节"],
      question_prompts: [currentQuestion],
      interaction_triggers: ["出现明确问题时先回答，再回到当前段落"],
      fact_guardrails: template.excludedTopics.map((topic) => `避免展开${topic}`),
      fallback_lines: ["这部分先收束一下，我们只聊节目范围内、低敏的观点。"],
      handoff_rule: "达到时长预算或收集到代表性观点后进入下一段",
      lock_level: "soft",
      cues: [],
    }),
  );

  return {
    script_id: scriptId,
    template_id: template.id,
    title,
    summary: `围绕「${title}」生成的可执行话题剧本。`,
    language: "zh-CN",
    scene: template.mode,
    phase_flow: phases,
    current_question: currentQuestion,
    next_question: "如果只保留一个结论，你希望它是什么？",
    target_duration_sec: targetDurationSec,
    safe_topic_kinds: template.safeTopicKinds,
    excluded_topics: template.excludedTopics,
    memory_policy: template.memoryPolicy,
    generated_by: "stelle-topic-script-service",
    prompt_version: "topic-script-v1",
    revision: input.revision ?? 1,
    approval_status: "draft",
    metadata: { source: "fallback_template" },
    sections,
  };
}

// === LLM Prompts ===

function buildGenerationPrompt(input: TopicScriptGenerationInput, fallback: TopicScriptDraft): string {
  return [
    "You generate Stelle live topic scripts as JSON only.",
    "Keep the script safe, interruptible, and suitable for Bilibili live chat.",
    "Do not include political news, medical diagnosis, legal judgement, investment advice, or private personal details.",
    "Return JSON matching this shape exactly:",
    JSON.stringify(fallback, null, 2),
    "Generation context:",
    JSON.stringify(
      {
        title: input.title,
        topic: input.topic,
        episodeSummary: input.episodeSummary,
        publicMemories: input.publicMemories ?? [],
      },
      null,
      2,
    ),
  ].join("\n\n");
}

function buildRevisionPrompt(input: TopicScriptRevisionInput, section: TopicScriptSection): string {
  return [
    "Revise one Stelle topic script section as JSON only.",
    "Only adjust soft speakable fields. Do not change section_id, phase, timestamp, duration_sec, or lock_level.",
    "Respect locked lines and avoid high-risk topics.",
    JSON.stringify({ section, viewerSignal: input.viewerSignal, factCorrection: input.factCorrection }, null, 2),
  ].join("\n\n");
}

// === Data Normalization ===

function normalizeDraft(raw: unknown, fallback: TopicScriptDraft): TopicScriptDraft {
  const value = asRecord(raw);
  const sections = Array.isArray(value.sections)
    ? value.sections.map((section, index) =>
        normalizeSection(section, fallback.sections[index] ?? fallback.sections[0]!),
      )
    : fallback.sections;

  return TopicScriptDraftSchema.parse({
    ...fallback,
    ...value,
    revision: Number(value.revision ?? fallback.revision),
    target_duration_sec: Number(value.target_duration_sec ?? fallback.target_duration_sec),
    sections,
  });
}

function normalizeSection(raw: unknown, fallback: TopicScriptSection): TopicScriptSection {
  const value = asRecord(raw);
  return TopicScriptSectionSchema.parse({
    ...fallback,
    ...value,
    duration_sec: Number(value.duration_sec ?? fallback.duration_sec),
    discussion_points: stringArray(value.discussion_points, fallback.discussion_points),
    question_prompts: stringArray(value.question_prompts, fallback.question_prompts),
    interaction_triggers: stringArray(value.interaction_triggers, fallback.interaction_triggers),
    fact_guardrails: stringArray(value.fact_guardrails, fallback.fact_guardrails),
    fallback_lines: stringArray(value.fallback_lines, fallback.fallback_lines),
  });
}

// === Internal Helpers ===

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value.map((item) => String(item).trim()).filter(Boolean);
  return items.length ? items : fallback;
}

function formatTimestamp(totalSec: number): string {
  const mm = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const ss = (totalSec % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
