import assert from "node:assert/strict";
import test from "node:test";

import { DiscordRouteDecider } from "../index.js";

const decider = new DiscordRouteDecider();

test("DiscordRouteDecider keeps ordinary mention handling inside Discord Cursor", () => {
  const decision = decider.decide({
    text: "@bot 解释一下 Context Transfer 是什么",
    isDm: false,
    mentionedOtherUsers: false,
  });

  assert.equal(decision.route, "cursor");
  assert.equal(decision.intent, "local_answer");
  assert.equal(decision.needsVerification, false);
});

test("DiscordRouteDecider lets Discord Cursor handle public news verification locally", () => {
  const decision = decider.decide({
    text: "@bot 今天 AI 新闻发生了什么，查一下来源",
    isDm: false,
    mentionedOtherUsers: false,
  });

  assert.equal(decision.route, "cursor");
  assert.equal(decision.intent, "fact_check");
  assert.equal(decision.needsVerification, true);
});

test("DiscordRouteDecider recalls Stelle for live, social, memory, and system actions", () => {
  assert.equal(decider.decide({ text: "@bot 给直播推流加一段语音", isDm: false, mentionedOtherUsers: false }).intent, "live_action");
  assert.equal(decider.decide({ text: "@bot 逗一下 <@123>", isDm: false, mentionedOtherUsers: true }).intent, "social_action");
  assert.equal(decider.decide({ text: "@bot 记住我喜欢短回复", isDm: false, mentionedOtherUsers: false }).intent, "memory_or_continuity");
  assert.equal(decider.decide({ text: "@bot 你现在在哪个窗口", isDm: false, mentionedOtherUsers: false }).intent, "self_or_system");
});
