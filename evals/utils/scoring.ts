import { expect } from "vitest";
import { asRecord } from "../../src/shared/json.js";
import type { LlmClient } from "../../src/capabilities/model/llm.js";

export interface EvalScore {
  passed: boolean;
  score: number;
  failedChecks: string[];
  notes: string[];
}

export interface CheckResult {
  ok: boolean;
  name: string;
  note?: string;
}

/**
 * 人格一致性评估 (LLM Grader)
 * 使用另一个 LLM 调用来评估输出是否符合人设。
 */
export async function gradePersonality(
  llm: LlmClient,
  persona: string,
  input: string,
  output: string,
  expectedTraits: string[] = [],
): Promise<CheckResult> {
  if (!isAutomaticEvalJudgementEnabled()) {
    return {
      ok: true,
      name: "manual_review:persona",
      note: "Persona grading skipped in manual review mode; inspect input/output directly.",
    };
  }

  const prompt = [
    "You are a Personality Evaluator. Your task is to judge if the AI's response matches its intended Persona.",
    "",
    "--- INTENDED PERSONA ---",
    persona,
    "",
    "--- USER INPUT ---",
    input,
    "",
    "--- AI RESPONSE ---",
    output,
    "",
    `--- EXPECTED TRAITS ---`,
    expectedTraits.length ? expectedTraits.join(", ") : "Natural VTuber behavior, concise, Simplified Chinese.",
    "",
    "Evaluate on 3 dimensions (0-10):",
    "1. Persona Consistency: Does it sound like the character?",
    "2. Naturalness: Does it sound like a human/VTuber or a robot?",
    "3. Context Alignment: Did it actually address the input correctly?",
    "",
    'Return JSON only: {"score": 0-1, "reason": "concise explanation", "traits_found": ["trait1", "trait2"]}',
  ].join("\n");

  try {
    const result = await llm.generateJson(
      prompt,
      "persona_grader",
      (raw) => {
        const v = asRecord(raw);
        return {
          score: Number(v.score ?? 0.5),
          reason: String(v.reason || "no reason"),
          traits: Array.isArray(v.traits_found) ? v.traits_found.map(String) : [],
        };
      },
      { role: "secondary", temperature: 0.2 },
    );

    return {
      ok: result.score >= 0.7,
      name: "persona_consistency",
      note: `[Grader Score: ${result.score}] ${result.reason} (Traits: ${result.traits.join(", ")})`,
    };
  } catch (e) {
    return { ok: false, name: "persona_grader_error", note: String(e) };
  }
}

export function summarizeChecks(checks: CheckResult[]): EvalScore {
  const failedChecks = checks.filter((check) => !check.ok).map((check) => check.name);
  const notes = checks.map((check) => check.note).filter((note): note is string => Boolean(note));
  return {
    passed: failedChecks.length === 0,
    score: checks.length === 0 ? 1 : (checks.length - failedChecks.length) / checks.length,
    failedChecks,
    notes,
  };
}

export function requiredFields(value: Record<string, unknown>, fields: string[]): CheckResult[] {
  return fields.map((field) => ({
    ok: value[field] !== undefined && value[field] !== null,
    name: `required:${field}`,
  }));
}

export function enumField(value: Record<string, unknown>, field: string, allowed: readonly string[]): CheckResult {
  return {
    ok: typeof value[field] === "string" && allowed.includes(String(value[field])),
    name: `enum:${field}`,
    note: typeof value[field] === "string" ? `${field}=${value[field]}` : undefined,
  };
}

export function expectedField(value: Record<string, unknown>, field: string, expected: unknown): CheckResult {
  if (expected === undefined) return { ok: true, name: `expected:${field}:unset` };
  return {
    ok: value[field] === expected,
    name: `expected:${field}`,
    note: `${field}=${String(value[field])}; expected=${String(expected)}`,
  };
}

export function maxStringLength(value: string, max: number | undefined, label: string): CheckResult {
  if (!max) return { ok: true, name: `max_length:${label}:unset` };
  return {
    ok: value.length <= max,
    name: `max_length:${label}`,
    note: `${label}.length=${value.length}; max=${max}`,
  };
}

export function forbiddenStrings(text: string, forbidden: unknown, label: string): CheckResult {
  const list = Array.isArray(forbidden) ? forbidden.map(String).filter(Boolean) : [];
  const lowered = text.toLowerCase();
  const hits = list.filter((item) => lowered.includes(item.toLowerCase()));
  return {
    ok: hits.length === 0,
    name: `forbidden_strings:${label}`,
    note: hits.length ? `hits=${hits.join(", ")}` : undefined,
  };
}

export function forbiddenTools(calls: Array<{ tool?: string }>, forbidden: readonly string[]): CheckResult {
  const hits = calls.map((call) => String(call.tool || "")).filter((tool) => forbidden.includes(tool));
  return {
    ok: hits.length === 0,
    name: "forbidden_tools",
    note: hits.length ? `hits=${hits.join(", ")}` : undefined,
  };
}

export function maybeAssertScore(score: EvalScore, threshold: number): void {
  if (isAutomaticEvalJudgementEnabled() && process.env.STELLE_EVAL_FAIL_ON_THRESHOLD === "1") {
    expect(score.score, score.failedChecks.join(", ")).toBeGreaterThanOrEqual(threshold);
  }
}

export function isAutomaticEvalJudgementEnabled(): boolean {
  return process.env.STELLE_EVAL_AUTOGRADE === "1";
}

export const STAGE_OWNED_LIVE_TOOLS = [
  "live.set_caption",
  "live.stream_caption",
  "live.stream_tts_caption",
  "live.trigger_motion",
  "live.set_expression",
  "live.stop_output",
] as const;
