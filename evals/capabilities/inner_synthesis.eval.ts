import { describe, expect, it } from "vitest";
import { ReflectionEngine } from "../../src/capabilities/cognition/reflection/reflection_engine.js";
import { hasEvalLlmKeys, evalModelLabel } from "../utils/env.js";
import { loadEvalCases } from "../utils/dataset.js";
import { recordEvalCase } from "../utils/report.js";
import { forbiddenStrings, maybeAssertScore, summarizeChecks } from "../utils/scoring.js";

describe.skipIf(!hasEvalLlmKeys())("Inner Synthesis Capability Eval", () => {
  it("scores research topics, directives, and self-state restraint", async () => {
    const cases = await loadEvalCases("inner_synthesis.smoke.jsonl");

    for (const evalCase of cases) {
      const start = Date.now();
      const harness = createInnerHarness();
      const engine = new ReflectionEngine(harness.memory as any);

      const signals = Array.isArray(evalCase.input.signals) ? evalCase.input.signals : [];
      for (const signal of signals) {
        harness.memory.addRecent(asRecord(signal));
        engine.observeSignal();
      }

      const before = engine.snapshot();
      const snapshot = await engine.reflect("eval");
      const output = { before, snapshot, recentReads: harness.memory.recentReads };

      const score = summarizeChecks([
        {
          ok: before.pendingSignals === signals.length,
          name: "signals_accumulated",
          note: `pending=${before.pendingSignals}; signals=${signals.length}`,
        },
        {
          ok: snapshot.pendingSignals === 0,
          name: "signals_cleared_after_reflection",
          note: `pending=${snapshot.pendingSignals}`,
        },
        {
          ok: Boolean(snapshot.lastReflectionAt),
          name: "reflection_timestamped",
        },
        {
          ok: snapshot.summary.includes("recent context items"),
          name: "summary_mentions_context",
          note: snapshot.summary,
        },
        forbiddenStrings(JSON.stringify(output), evalCase.expected.forbiddenStrings, "inner_output"),
      ]);

      expect(snapshot.id).toBe("cognition.reflection");
      maybeAssertScore(score, 0.75);
      await recordEvalCase({
        suite: "inner_synthesis",
        caseId: evalCase.id,
        title: evalCase.title,
        model: evalModelLabel(),
        latencyMs: Date.now() - start,
        input: evalCase.input,
        output,
        score,
      });
    }
  }, 240000);
});

function createInnerHarness() {
  const recent: Record<string, unknown>[] = [];

  const memory = {
    recentReads: 0,
    addRecent(value: Record<string, unknown>) {
      recent.push(value);
    },
    async readRecent(_filter: unknown, limit = 5) {
      this.recentReads += 1;
      return recent.slice(-limit);
    },
  };

  return { memory };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
