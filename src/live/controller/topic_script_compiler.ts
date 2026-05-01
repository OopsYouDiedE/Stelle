// === Imports ===
import { parse as parseYaml } from "yaml";
import {
  TopicScriptDraftSchema,
  type CompiledTopicScript,
  type TopicScriptDraft,
  type TopicScriptSection,
} from "./topic_script_schema.js";

// === Types & Errors ===
export interface TopicScriptCompileResult {
  draft: TopicScriptDraft;
  compiled: CompiledTopicScript;
}

export class TopicScriptCompileError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "TopicScriptCompileError";
  }
}

// === Core Compilation ===

export function compileTopicScriptMarkdown(markdown: string): TopicScriptCompileResult {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const base = parseYaml(frontmatter) as Record<string, unknown>;
  const sections = parseSections(body);
  const parsed = TopicScriptDraftSchema.safeParse({ ...base, sections });
  if (!parsed.success) {
    throw new TopicScriptCompileError("Invalid topic script markdown", parsed.error.format());
  }
  const draft = parsed.data;
  const compiled = compileTopicScriptDraft(draft);
  return { draft, compiled };
}

export function compileTopicScriptDraft(draft: TopicScriptDraft): CompiledTopicScript {
  const ids = new Set<string>();
  let previousStart = -1;
  const sections = draft.sections.map((section) => {
    if (ids.has(section.section_id)) {
      throw new TopicScriptCompileError(`Duplicate section_id: ${section.section_id}`);
    }
    ids.add(section.section_id);
    if (!draft.phase_flow.includes(section.phase)) {
      throw new TopicScriptCompileError(`Section ${section.section_id} phase ${section.phase} is not in phase_flow`);
    }
    const startOffsetSec = parseTimestamp(section.timestamp);
    if (startOffsetSec < previousStart) {
      throw new TopicScriptCompileError(`Section ${section.section_id} starts before the previous section`);
    }
    previousStart = startOffsetSec;

    const isLocked = section.lock_level === "locked";
    const isSoft = section.lock_level === "soft";
    const isSystem = section.lock_level === "system";

    return {
      id: section.section_id,
      phase: section.phase,
      startOffsetSec,
      durationSec: section.duration_sec,
      goal: section.goal,
      lockedLines: isLocked ? [section.host_script] : [],
      softLines: isSoft ? [section.host_script, ...section.discussion_points] : [...section.discussion_points],
      systemLines: isSystem ? [section.host_script] : [],
      questionPrompts: section.question_prompts,
      triggers: section.interaction_triggers.map((text) => ({ text })),
      guardrails: section.fact_guardrails,
      fallbackLines: section.fallback_lines,
      handoffRule: section.handoff_rule,
      operatorNotes: section.operator_notes,
      lockLevel: section.lock_level,
      cues: section.cues,
    };
  });

  return {
    scriptId: draft.script_id,
    revision: draft.revision,
    templateId: draft.template_id,
    title: draft.title,
    summary: draft.summary,
    language: draft.language,
    scene: draft.scene,
    approvalStatus: draft.approval_status,
    totalDurationSec: draft.target_duration_sec,
    currentQuestion: draft.current_question,
    nextQuestion: draft.next_question,
    safeTopicKinds: draft.safe_topic_kinds,
    excludedTopics: draft.excluded_topics,
    memoryPolicy: draft.memory_policy,
    sections,
    metadata: draft.metadata,
  };
}

// === Markdown Rendering ===

export function renderTopicScriptMarkdown(draft: TopicScriptDraft): string {
  const { sections, ...frontmatter } = draft;
  const header = `---\n${stringifyYaml(frontmatter)}---`;
  const body = sections.map(renderSection).join("\n\n");
  return `${header}\n\n${body}\n`;
}

function renderSection(section: TopicScriptSection): string {
  const lines = [`# ${section.section_id}`];
  const keys: Array<keyof TopicScriptSection> = [
    "section_id",
    "phase",
    "timestamp",
    "duration_sec",
    "goal",
    "host_script",
    "discussion_points",
    "question_prompts",
    "interaction_triggers",
    "fact_guardrails",
    "fallback_lines",
    "cues",
    "handoff_rule",
    "operator_notes",
    "lock_level",
  ];
  for (const key of keys) {
    const value = section[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`- ${key}:`);
      for (const item of value) lines.push(`  - ${item}`);
    } else {
      lines.push(`- ${key}: ${value}`);
    }
  }
  return lines.join("\n");
}

function stringifyYaml(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => {
      if (Array.isArray(entry)) {
        return `${key}:\n${entry.map((item) => `  - ${item}`).join("\n")}\n`;
      }
      if (entry && typeof entry === "object") {
        return `${key}: ${JSON.stringify(entry)}\n`;
      }
      return `${key}: ${entry}\n`;
    })
    .join("");
}

// === Markdown Parsing ===

function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  const normalized = markdown.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/m.exec(normalized);
  if (!match) throw new TopicScriptCompileError("Topic script markdown must start with YAML frontmatter");
  return { frontmatter: match[1] ?? "", body: match[2] ?? "" };
}

function parseSections(body: string): TopicScriptSection[] {
  const parts = body
    .split(/^#\s+/m)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.map((part, index) => {
    const lines = part.split(/\r?\n/);
    const heading = lines.shift()?.trim();
    const values = parseSectionFields(lines);
    if (!values.section_id && heading) values.section_id = slugify(heading);
    try {
      return TopicScriptDraftSchema.shape.sections.element.parse(values);
    } catch (error) {
      throw new TopicScriptCompileError(`Invalid section ${values.section_id ?? index + 1}`, error);
    }
  });
}

// === Section Field Parser ===

function parseSectionFields(lines: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let currentListKey: string | undefined;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const scalar = /^-\s+([a-zA-Z0-9_]+):(?:\s+(.*))?$/.exec(line);
    if (scalar) {
      const key = scalar[1]!;
      const value = scalar[2];
      currentListKey = undefined;
      if (value === undefined || value === "") {
        out[key] = [];
        currentListKey = key;
      } else {
        out[key] = coerceScalar(value);
      }
      continue;
    }
    const listItem = /^\s+-\s+(.+)$/.exec(line);
    if (listItem && currentListKey) {
      const existing = Array.isArray(out[currentListKey]) ? (out[currentListKey] as unknown[]) : [];
      existing.push(coerceScalar(listItem[1]!));
      out[currentListKey] = existing;
      continue;
    }
  }
  const listKeys = [
    "discussion_points",
    "question_prompts",
    "interaction_triggers",
    "fact_guardrails",
    "fallback_lines",
    "cues",
  ];
  for (const key of listKeys) {
    if (out[key] === undefined) out[key] = [];
    if (!Array.isArray(out[key])) out[key] = [String(out[key])];
  }
  return out;
}

// === Parser Utilities ===

function parseTimestamp(value: string): number {
  const parts = value.split(":").map((v) => parseInt(v, 10));
  if (parts.some((p) => isNaN(p))) throw new TopicScriptCompileError(`Invalid timestamp: ${value}`);
  if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
  if (parts.length === 3) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  return parts[0] || 0;
}

function coerceScalar(value: string): unknown {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed.replace(/^["']|["']$/g, "");
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_")
      .replace(/^_+|_+$/g, "") || "section"
  );
}
