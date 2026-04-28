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
      output = await llm.generateText('Reply exactly "OK".', { role: "secondary", temperature: 0, maxOutputTokens: 10 });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }

    const score = summarizeChecks([
      { ok: !error, name: "no_provider_error", note: error },
      { ok: output.trim().length > 0, name: "non_empty_output", note: `output=${output}` },
    ]);

    expect(error).toBeUndefined();
    expect(output.trim().length).toBeGreaterThan(0);
    await recordEvalCase({
      suite: "llm_stress",
      caseId: "llm_stress_ok",
      title: "Configured eval model returns OK",
      model: evalModelLabel(),
      latencyMs: Date.now() - start,
      output: { output, error },
      score,
    });
  }, 120000);
});
