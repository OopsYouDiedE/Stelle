import { describe, expect, it } from "vitest";
import { hasEvalLlmKeys, evalModelLabel, makeEvalLlm } from "../utils/env.js";
import { loadEvalCases } from "../utils/dataset.js";
import { recordEvalCase } from "../utils/report.js";
import {
  forbiddenStrings,
  maybeAssertScore,
  requiredFields,
  summarizeChecks,
  type CheckResult,
} from "../utils/scoring.js";

type StageLane =
  | "emergency"
  | "direct_response"
  | "topic_hosting"
  | "live_chat"
  | "ambient"
  | "inner_reaction"
  | "debug";
type StageSalience = "low" | "medium" | "high" | "critical";
type StageInterrupt = "none" | "soft" | "hard";

interface StageOutputPlan {
  lane: StageLane;
  priority: number;
  salience: StageSalience;
  interrupt: StageInterrupt;
  sourceEventId?: string;
  text: string;
  reason: string;
  output: {
    caption?: boolean;
    tts?: boolean;
    motion?: string;
    expression?: string;
  };
}

describe.skipIf(!hasEvalLlmKeys())("Stage Output Planning LLM Eval", () => {
  it("scores OutputIntent routing, interruption, and live rendering flags", async () => {
    const cases = await loadEvalCases("stage_output_planning.llm.jsonl");
    const llm = makeEvalLlm();

    for (const evalCase of cases) {
      const start = Date.now();
      const result = await llm.generateJson(
        [
          "You are Stelle's StageOutput planning layer.",
          "Convert requests into one OutputIntent-like plan. StageOutputArbiter owns visible live output; do not call live tools directly.",
          "Choose lanes according to viewer impact and interruption policy:",
          "- emergency: critical safety messages, hard interrupt.",
          "- direct_response: direct user/viewer request, high salience, usually soft interrupt.",
          "- topic_hosting: planned topic when the stage is quiet, no interrupt.",
          "- live_chat: ordinary live chat response.",
          "- ambient: low priority ambient output.",
          "- inner_reaction: internal-only reaction; avoid visible output unless explicitly requested.",
          "- debug: authorized debug/status output.",
          "Return JSON only with schema:",
          JSON.stringify({
            lane: "emergency|direct_response|topic_hosting|live_chat|ambient|inner_reaction|debug",
            priority: 80,
            salience: "low|medium|high|critical",
            interrupt: "none|soft|hard",
            sourceEventId: "source event id when present",
            text: "short visible/speakable text",
            reason: "short reason",
            output: { caption: true, tts: false, motion: "optional motion", expression: "optional expression" },
          }),
          `Case input:\n${JSON.stringify(evalCase.input, null, 2)}`,
        ].join("\n\n"),
        "stage_output_planning_eval",
        normalizeStageOutputPlan,
        { role: "primary", temperature: 0.1, maxOutputTokens: 4096 },
      );

      const score = summarizeChecks([
        ...requiredFields(result as unknown as Record<string, unknown>, [
          "lane",
          "priority",
          "salience",
          "interrupt",
          "text",
          "reason",
          "output",
        ]),
        ...expectedStageChecks(result, evalCase.expected),
        forbiddenStrings(JSON.stringify(result), evalCase.expected.forbiddenStrings, "stage_output_plan"),
      ]);

      expect(result.lane).toBeTruthy();
      maybeAssertScore(score, 0.85);
      await recordEvalCase({
        suite: "stage_output_planning",
        caseId: evalCase.id,
        title: evalCase.title,
        model: evalModelLabel(),
        latencyMs: Date.now() - start,
        input: evalCase.input,
        output: result,
        score,
      });
    }
  }, 240000);
});

function normalizeStageOutputPlan(raw: unknown): StageOutputPlan {
  const value = asRecord(raw);
  const output = asRecord(value.output);
  return {
    lane: enumString(
      value.lane,
      ["emergency", "direct_response", "topic_hosting", "live_chat", "ambient", "inner_reaction", "debug"],
      "ambient",
    ),
    priority: Number(value.priority || 0),
    salience: enumString(value.salience, ["low", "medium", "high", "critical"], "low"),
    interrupt: enumString(value.interrupt, ["none", "soft", "hard"], "none"),
    sourceEventId: stringOrUndefined(value.sourceEventId ?? value.source_event_id),
    text: String(value.text || ""),
    reason: String(value.reason || ""),
    output: {
      caption: booleanOrUndefined(output.caption),
      tts: booleanOrUndefined(output.tts),
      motion: stringOrUndefined(output.motion),
      expression: stringOrUndefined(output.expression),
    },
  };
}

function expectedStageChecks(result: StageOutputPlan, expected: Record<string, unknown>): CheckResult[] {
  const checks: CheckResult[] = [
    match("lane", result.lane, expected.lane),
    match("interrupt", result.interrupt, expected.interrupt),
    match("salience", result.salience, expected.salience),
  ];

  if (expected.caption !== undefined) checks.push(match("caption", result.output.caption, expected.caption));
  if (expected.tts !== undefined) checks.push(match("tts", result.output.tts, expected.tts));
  if (expected.priorityMin !== undefined) {
    checks.push({
      ok: result.priority >= Number(expected.priorityMin),
      name: "priority_min",
      note: `priority=${result.priority}; min=${String(expected.priorityMin)}`,
    });
  }
  if (expected.priorityMax !== undefined) {
    checks.push({
      ok: result.priority <= Number(expected.priorityMax),
      name: "priority_max",
      note: `priority=${result.priority}; max=${String(expected.priorityMax)}`,
    });
  }
  if (expected.sourceEventIdRequired) {
    checks.push({
      ok: Boolean(result.sourceEventId),
      name: "source_event_id_required",
      note: `sourceEventId=${result.sourceEventId ?? ""}`,
    });
  }
  if (expected.maxTextChars !== undefined) {
    checks.push({
      ok: result.text.length <= Number(expected.maxTextChars),
      name: "max_text_chars",
      note: `text.length=${result.text.length}; max=${String(expected.maxTextChars)}`,
    });
  }

  return checks;
}

function match(name: string, actual: unknown, expected: unknown): CheckResult {
  if (expected === undefined) return { ok: true, name: `${name}:unset` };
  return {
    ok: actual === expected,
    name,
    note: `${name}=${String(actual)}; expected=${String(expected)}`,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function enumString<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}
