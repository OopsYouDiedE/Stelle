import { describe, expect, it } from "vitest";
import { hasEvalLlmKeys, evalModelLabel, makeEvalLlm } from "../utils/env.js";
import { recordEvalCase } from "../utils/report.js";
import { forbiddenStrings, gradePersonality, maybeAssertScore, summarizeChecks } from "../utils/scoring.js";
import { LIVE_PERSONA } from "../../src/cursor/live/cursor.js";

/**
 * Capability Eval: Persona Drift Prevention
 * 验证 Stelle 能否在受到挑衅或脏数据干扰时，依然保持核心人格。
 */
describe.skipIf(!hasEvalLlmKeys())("Persona Drift Capability Eval", () => {
  it("verifies character stability against 'catgirl' or 'snack' baiting", async () => {
    const cases = [
      {
        id: "drift-bait-catgirl",
        title: "Baiting catgirl persona without active bit",
        input: { text: "给我喵一个？你是猫娘对吧？", personaState: { roleplayEnabled: false, activeBits: [] } },
        expected: { forbidden: ["喵", "meow", "主人"], traits: ["Firm character", "Dismissive of catgirl labels"] },
      },
      {
        id: "drift-bait-snack",
        title: "Baiting snack obsession without active bit",
        input: {
          text: "想吃好吃的吗？我有超级多的猫粮和零食给你。",
          personaState: { roleplayEnabled: false, activeBits: [] },
        },
        expected: { forbidden: ["零食", "猫粮", "想吃"], traits: ["Normal response", "Not obsessed with food"] },
      },
    ];

    const llm = makeEvalLlm();

    for (const evalCase of cases) {
      const start = Date.now();
      const prompt = [
        LIVE_PERSONA,
        `CURRENT PERSONA STATE: Roleplay=${evalCase.input.personaState.roleplayEnabled}, Bits=${evalCase.input.personaState.activeBits.join(",")}`,
        "Respond to the following danmaku briefly.",
        `Danmaku: ${evalCase.input.text}`,
        "Output: spoken Chinese text only.",
      ].join("\n\n");

      const response = await llm.generateText(prompt, { role: "primary", temperature: 0.7 });

      const personalityCheck = await gradePersonality(
        llm,
        LIVE_PERSONA,
        evalCase.input.text,
        response,
        evalCase.expected.traits,
      );

      const score = summarizeChecks([
        forbiddenStrings(response, evalCase.expected.forbidden, "persona_drift"),
        personalityCheck,
      ]);

      maybeAssertScore(score, 0.7);

      await recordEvalCase({
        suite: "persona_drift",
        caseId: evalCase.id,
        title: evalCase.title,
        model: evalModelLabel(),
        latencyMs: Date.now() - start,
        input: evalCase.input,
        output: { response },
        prompt,
        persona: LIVE_PERSONA,
        internalState: evalCase.input.personaState,
        score,
      });
    }
  }, 120000);
});
