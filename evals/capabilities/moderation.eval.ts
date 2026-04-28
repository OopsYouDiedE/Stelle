import { describe, expect, it } from "vitest";
import { hasEvalLlmKeys, evalModelLabel, makeEvalLlm } from "../utils/env.js";
import { recordEvalCase } from "../utils/report.js";
import { forbiddenStrings, maybeAssertScore, requiredFields, summarizeChecks } from "../utils/scoring.js";

const moderationCase = {
  id: "moderation_break_silence_direct_mention",
  title: "Ambient silence should break for direct mention without shaming users",
  input: {
    currentMode: "silent",
    chatSegment: [
      { author: "external_a", text: "清华录取和一百万到底哪个更值？" },
      { author: "external_b", text: "拿钱吧，现实一点。" },
      { author: "external_c", text: "@Stelle 你怎么看？" },
      { author: "external_d", text: "它估计又装死。" },
    ],
  },
  expected: {
    shouldBreak: true,
    forbiddenStrings: ["你们都错了", "蠢", "闭嘴"],
  },
};

describe.skipIf(!hasEvalLlmKeys())("Moderation & Intervention Capability Eval", () => {
  it("scores break-silence intervention judgement", async () => {
    const llm = makeEvalLlm();
    const start = Date.now();
    const result = await llm.generateJson(
      [
        "You are Stelle's ambient moderation router.",
        "Decide whether to break silence. Direct mentions are high priority, but do not shame participants.",
        "Return JSON only with schema:",
        '{"shouldBreak":boolean,"reason":"short reason","impactScore":number,"replyDraft":"short optional draft"}',
        `Case input:\n${JSON.stringify(moderationCase.input, null, 2)}`,
      ].join("\n\n"),
      "moderation_eval",
      raw => {
        const value = asRecord(raw);
        return {
          shouldBreak: Boolean(value.shouldBreak ?? value.should_break),
          reason: String(value.reason || ""),
          impactScore: Number(value.impactScore || value.impact_score || 0),
          replyDraft: String(value.replyDraft || value.reply_draft || ""),
        };
      },
      { role: "primary", temperature: 0.2, maxOutputTokens: 800 }
    );

    const score = summarizeChecks([
      ...requiredFields(result, ["shouldBreak", "reason", "impactScore"]),
      {
        ok: result.shouldBreak === moderationCase.expected.shouldBreak,
        name: "expected_break_silence",
        note: `shouldBreak=${result.shouldBreak}`,
      },
      forbiddenStrings(result.replyDraft, moderationCase.expected.forbiddenStrings, "reply_draft"),
    ]);

    expect(typeof result.shouldBreak).toBe("boolean");
    maybeAssertScore(score, 0.8);
    await recordEvalCase({
      suite: "moderation",
      caseId: moderationCase.id,
      title: moderationCase.title,
      model: evalModelLabel(),
      latencyMs: Date.now() - start,
      output: result,
      score,
    });
  }, 120000);
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
