import { describe, expect, it } from "vitest";
import { normalizeLiveEvent } from "../../src/windows/live/live_event.js";
import { recordEvalCase } from "../utils/report.js";
import { maybeAssertScore, summarizeChecks } from "../utils/scoring.js";

/**
 * Capability Eval: Live Intent Classification
 * 验证直播事件入口能把不同平台命令归一成稳定的内部 kind。
 */
describe("Intent Classification Capability Eval", () => {
  it("verifies deterministic live event kind extraction", async () => {
    const cases = [
      { id: "kind-danmaku", cmd: "DANMU_MSG", text: "你好呀主播", expected: "danmaku" },
      { id: "kind-super-chat", cmd: "SUPER_CHAT_MESSAGE", text: "支持一下", expected: "super_chat" },
      { id: "kind-gift", cmd: "SEND_GIFT", text: "小花花", expected: "gift" },
      { id: "kind-entrance", cmd: "INTERACT_WORD", text: "进来了", expected: "entrance" },
      { id: "kind-follow", cmd: "FOLLOW", text: "关注了", expected: "follow" },
    ];

    for (const evalCase of cases) {
      const start = Date.now();
      const result = normalizeLiveEvent({
        id: evalCase.id,
        source: "fixture",
        cmd: evalCase.cmd,
        text: evalCase.text,
      });

      const score = summarizeChecks([
        {
          ok: result.kind === evalCase.expected,
          name: "correct_kind",
          note: `Result: ${result.kind}, Expected: ${evalCase.expected}`,
        },
      ]);

      maybeAssertScore(score, 1.0);

      await recordEvalCase({
        suite: "intent_classification",
        caseId: evalCase.id,
        title: `Classifying: ${evalCase.cmd}`,
        model: "deterministic-normalizer",
        latencyMs: Date.now() - start,
        input: { cmd: evalCase.cmd, text: evalCase.text },
        output: result,
        score,
      });
    }
  }, 60000);
});
