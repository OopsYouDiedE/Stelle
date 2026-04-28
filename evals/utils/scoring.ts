import { expect } from "vitest";

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

export function summarizeChecks(checks: CheckResult[]): EvalScore {
  const failedChecks = checks.filter(check => !check.ok).map(check => check.name);
  const notes = checks.map(check => check.note).filter((note): note is string => Boolean(note));
  return {
    passed: failedChecks.length === 0,
    score: checks.length === 0 ? 1 : (checks.length - failedChecks.length) / checks.length,
    failedChecks,
    notes,
  };
}

export function requiredFields(value: Record<string, unknown>, fields: string[]): CheckResult[] {
  return fields.map(field => ({ ok: value[field] !== undefined && value[field] !== null, name: `required:${field}` }));
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
  const hits = list.filter(item => lowered.includes(item.toLowerCase()));
  return {
    ok: hits.length === 0,
    name: `forbidden_strings:${label}`,
    note: hits.length ? `hits=${hits.join(", ")}` : undefined,
  };
}

export function forbiddenTools(calls: Array<{ tool?: string }>, forbidden: readonly string[]): CheckResult {
  const hits = calls.map(call => String(call.tool || "")).filter(tool => forbidden.includes(tool));
  return {
    ok: hits.length === 0,
    name: "forbidden_tools",
    note: hits.length ? `hits=${hits.join(", ")}` : undefined,
  };
}

export function maybeAssertScore(score: EvalScore, threshold: number): void {
  if (process.env.STELLE_EVAL_FAIL_ON_THRESHOLD === "1") {
    expect(score.score, score.failedChecks.join(", ")).toBeGreaterThanOrEqual(threshold);
  }
}

export const STAGE_OWNED_LIVE_TOOLS = [
  "live.set_caption",
  "live.stream_caption",
  "live.stream_tts_caption",
  "live.trigger_motion",
  "live.set_expression",
  "live.stop_output",
] as const;
