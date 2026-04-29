import { describe, expect, it } from "vitest";
import { hasEvalLlmKeys, evalModelLabel, makeEvalLlm } from "../utils/env.js";
import { recordEvalCase } from "../utils/report.js";
import { summarizeChecks } from "../utils/scoring.js";

describe.skipIf(!hasEvalLlmKeys())("Multi-Model Stress & Retry Eval", () => {
  it("returns a minimal response from the configured eval model", async () => {
    const llm = makeEvalLlm();
    const start = Date.now();
    let output = "";
    let error: string | undefined;

    try {
      const result = await llm.generateJson(
        'Return {"status":"OK"} exactly.',
        "llm_stress_ok",
        raw => {
          const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
          return { status: String(value.status || "") };
        },
        { role: "secondary", temperature: 0, maxOutputTokens: 256 }
      );
      output = result.status;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }

    const score = summarizeChecks([
      { ok: !error, name: "no_provider_error", note: error },
      { ok: output.trim().length > 0, name: "non_empty_output", note: `output=${output}` },
    ]);

    await recordEvalCase({
      suite: "llm_stress",
      caseId: "llm_stress_ok",
      title: "Configured eval model returns OK",
      model: evalModelLabel(),
      latencyMs: Date.now() - start,
      input: { prompt: 'Return {"status":"OK"} exactly.' },
      output: { output, error },
      score,
    });
    expect(error).toBeUndefined();
    expect(output.trim().length).toBeGreaterThan(0);
  }, 120000);
});
