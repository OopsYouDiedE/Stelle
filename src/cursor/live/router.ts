import { asRecord, enumValue } from "../../utils/json.js";
import { sanitizeExternalText, truncateText } from "../../utils/text.js";
import type { NormalizedLiveEvent } from "../../utils/live_event.js";
import type { CursorContext } from "../types.js";
import type { LiveBatchDecision, LiveEmotion } from "./types.js";

/**
 * 模块：Live Router (决策与思维)
 */
export class LiveRouter {
  constructor(private readonly context: CursorContext, private readonly persona: string) {}

  /**
   * 决策：分析弹幕批次并生成回复策略
   */
  public async decide(batch: NormalizedLiveEvent[], recentSpeech: string[], currentEmotion: string, policyOverlay: string[]): Promise<LiveBatchDecision> {
    const batchLog = batch.map(e => `[${e.priority}] ${e.user?.name ?? "观众"}: ${e.text}`).join("\n");
    const focus = await this.context.memory?.readLongTerm("current_focus", "self_state").catch(() => null);
    const subconscious = await this.context.memory?.readLongTerm("global_subconscious", "self_state").catch(() => null);

    const prompt = [
      this.persona,
      subconscious ? `Internal subconscious guidance:\n${subconscious}` : undefined,
      policyOverlay.length ? `MANDATORY DIRECTIVES:\n${policyOverlay.join("\n")}` : undefined,
      `Current Focus:\n${focus ?? "Relaxed chatting"}`,
      `What you just said (DO NOT REPEAT):\n${recentSpeech.join("\n") || "(Silent)"}`,
      `Current Emotion: ${currentEmotion}`,
      `\nLATEST CHAT BATCH:\n${batchLog}`
    ].filter(Boolean).join("\n\n");

    return this.context.llm.generateJson(
      prompt,
      "live_batch_decision",
      (raw) => {
        const v = asRecord(raw);
        return {
          action: enumValue(v.action, ["respond_to_crowd", "respond_to_specific", "drop_noise", "generate_topic"] as const, "drop_noise"),
          emotion: enumValue(v.emotion, ["neutral", "happy", "laughing", "sad", "surprised", "thinking", "teasing"] as const, "neutral") as LiveEmotion,
          intensity: typeof v.intensity === "number" ? v.intensity : 3,
          script: sanitizeExternalText(String(v.script || "")),
          reason: String(v.reason || "auto")
        };
      },
      { role: "primary", temperature: 0.65 }
    );
  }

  /**
   * 话题：在冷场时生成一个新话题
   */
  public async generateTopic(recentSpeech: string[], currentEmotion: string, policyOverlay: string[]): Promise<string> {
    const focus = await this.context.memory?.readLongTerm("current_focus", "self_state").catch(() => null);
    const subconscious = await this.context.memory?.readLongTerm("global_subconscious", "self_state").catch(() => null);

    const prompt = [
      this.persona,
      subconscious ? `Internal subconscious guidance:\n${subconscious}` : undefined,
      policyOverlay.length ? `MANDATORY DIRECTIVES:\n${policyOverlay.join("\n")}` : undefined,
      "Chat is quiet. Generate ONE short, engaging sentence to keep the stream lively.",
      `Current Focus:\n${focus ?? "Relaxed chatting"}`,
      `What you just said:\n${recentSpeech.join("\n") || "(none)"}`
    ].filter(Boolean).join("\n\n");

    return this.context.llm.generateText(prompt, { role: "secondary", temperature: 0.8 });
  }
}
