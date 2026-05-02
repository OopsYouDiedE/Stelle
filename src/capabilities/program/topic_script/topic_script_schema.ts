// === Imports ===
import { z } from "zod";
import type { ProgramMode, TopicPhase } from "../stage_director/types.js";

// === Constants & Basic Types ===
export const topicScriptApprovalStatusValues = ["draft", "reviewed", "approved", "archived"] as const;
export type TopicScriptApprovalStatus = (typeof topicScriptApprovalStatusValues)[number];

export const topicScriptLockLevelValues = ["locked", "soft", "system"] as const;
export type TopicScriptLockLevel = (typeof topicScriptLockLevelValues)[number];

export const topicScriptRuntimeDecisionValues = [
  "continue_section",
  "answer_question",
  "use_fallback",
  "request_patch",
  "human_review",
] as const;
export type TopicScriptRuntimeDecision = (typeof topicScriptRuntimeDecisionValues)[number];

// === Zod Schemas ===

export const TopicScriptCueSchema = z.object({
  type: z.enum(["sfx", "vfx", "camera", "emotion"]),
  id: z.string().min(1),
  params: z.record(z.unknown()).optional(),
  timestamp_offset: z.number().optional(),
});

export type TopicScriptCue = z.infer<typeof TopicScriptCueSchema>;

export const TopicScriptSectionSchema = z.object({
  section_id: z.string().min(1),
  phase: z.enum(["opening", "sampling", "clustering", "debating", "summarizing", "closing"]),
  timestamp: z.string().regex(/^\d{1,2}:\d{2}(?::\d{2})?$/),
  duration_sec: z.number().int().positive(),
  goal: z.string().min(1),
  host_script: z.string().min(1),
  discussion_points: z.array(z.string().min(1)).min(1),
  question_prompts: z.array(z.string().min(1)).min(1),
  interaction_triggers: z.array(z.string().min(1)).default([]),
  fact_guardrails: z.array(z.string().min(1)).default([]),
  fallback_lines: z.array(z.string().min(1)).min(1),
  handoff_rule: z.string().min(1),
  operator_notes: z.string().optional(),
  lock_level: z.enum(topicScriptLockLevelValues).default("soft"),
  cues: z.array(TopicScriptCueSchema).default([]),
});

export type TopicScriptSection = z.infer<typeof TopicScriptSectionSchema>;

export const TopicScriptDraftSchema = z.object({
  script_id: z.string().min(1),
  template_id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  language: z.string().min(2).default("zh-CN"),
  scene: z.enum(["observation", "court", "lab", "archive", "diagnosis", "story", "reflection"]),
  phase_flow: z.array(z.enum(["opening", "sampling", "clustering", "debating", "summarizing", "closing"])).min(1),
  current_question: z.string().min(1),
  next_question: z.string().optional(),
  target_duration_sec: z.number().int().positive(),
  safe_topic_kinds: z.array(z.string().min(1)).min(1),
  excluded_topics: z.array(z.string().min(1)).default([]),
  memory_policy: z.enum(["none", "public_episode_summary", "public_proposal_only"]),
  generated_by: z.string().optional(),
  prompt_version: z.string().optional(),
  revision: z.number().int().nonnegative(),
  approval_status: z.enum(topicScriptApprovalStatusValues),
  metadata: z.record(z.unknown()).default({}),
  sections: z.array(TopicScriptSectionSchema).min(1),
});

export type TopicScriptDraft = z.infer<typeof TopicScriptDraftSchema>;

// === Compiled Types ===

export interface TopicScriptTrigger {
  text: string;
}

export interface CompiledTopicScriptSection {
  id: string;
  phase: TopicPhase;
  startOffsetSec: number;
  durationSec: number;
  goal: string;
  lockedLines: string[];
  softLines: string[];
  systemLines: string[];
  questionPrompts: string[];
  triggers: TopicScriptTrigger[];
  guardrails: string[];
  fallbackLines: string[];
  handoffRule: string;
  operatorNotes?: string;
  lockLevel: TopicScriptLockLevel;
  cues: TopicScriptCue[];
}

export interface CompiledTopicScript {
  scriptId: string;
  revision: number;
  templateId: string;
  title: string;
  summary: string;
  language: string;
  scene: ProgramMode;
  approvalStatus: TopicScriptApprovalStatus;
  totalDurationSec: number;
  currentQuestion: string;
  nextQuestion?: string;
  safeTopicKinds: string[];
  excludedTopics: string[];
  memoryPolicy: TopicScriptDraft["memory_policy"];
  sections: CompiledTopicScriptSection[];
  metadata: Record<string, unknown>;
}

// === Runtime Decision ===

export const TopicScriptRuntimeDecisionSchema = z.object({
  action: z.enum(topicScriptRuntimeDecisionValues),
  section_id: z.string().optional(),
  text: z.string().default(""),
  reason: z.string().default(""),
  priority: z.number().int().min(0).max(100).default(40),
});

export type TopicScriptRuntimeDecisionPlan = z.infer<typeof TopicScriptRuntimeDecisionSchema>;
