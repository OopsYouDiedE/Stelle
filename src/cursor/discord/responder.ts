import { truncateText, sanitizeExternalText } from "../../utils/text.js";
import { asRecord } from "../../utils/json.js";
import type { DiscordMessageSummary } from "../../utils/discord.js";
import type { CursorContext } from "../types.js";
import type { DiscordReplyPolicy, DiscordToolResultView, DiscordChannelSession } from "./types.js";

/**
 * 模块：DiscordResponder (表达层)
 * 职责：回复生成、Discord 发送、记忆捕获、反思上报。
 */
export class DiscordResponder {
  constructor(private readonly context: CursorContext, private readonly persona: string, private readonly cursorId: string) {}

  public async respond(
    session: DiscordChannelSession,
    batch: DiscordMessageSummary[],
    policy: DiscordReplyPolicy,
    toolResults: DiscordToolResultView[]
  ): Promise<string> {
    if (!this.context.config.models.apiKey) return "API is offline.";

    const history = session.history.slice(-12).map(m => `${m.author.username}: ${m.cleanContent}`).join("\n");
    const batchContent = batch.map(m => `${m.author.username}: ${m.cleanContent}`).join("\n");
    const toolBlock = toolResults.length ? truncateText(JSON.stringify(toolResults, null, 2), 3000) : "(none)";
    const subconscious = await this.context.memory?.readLongTerm("global_subconscious").catch(() => null);

    const prompt = [
      this.persona,
      subconscious ? `Internal subconscious guidance:\n${subconscious}` : undefined,
      "You are Layer 3 (Execution). Generate the final plain-text reply.",
      "Rules: No JSON, no internal chain-of-thought visible to users.",
      policy.needsThinking ? "Think carefully. Provide a deliberate, accurate answer." : "Give a fast, natural, direct answer.",
      `Intent: ${policy.intent}`,
      `Recent history:\n${history}`,
      `Tool context:\n${toolBlock}`,
      `Target messages to reply to:\n${batchContent}`,
    ].filter(Boolean).join("\n\n");

    try {
      const text = await this.context.llm.generateText(prompt, {
        role: policy.needsThinking ? "primary" : "secondary",
        temperature: policy.needsThinking ? 0.3 : 0.7,
        maxOutputTokens: policy.needsThinking ? 500 : 200,
      });
      return truncateText(text || "...", this.context.config.discord.maxReplyChars);
    } catch {
      return "抱歉，刚才脑子卡了一下。";
    }
  }

  public async sendAndArchive(
    latestMessage: DiscordMessageSummary,
    replyText: string,
    policy: DiscordReplyPolicy
  ): Promise<DiscordMessageSummary> {
    // 1. 发送
    const result = await this.context.tools.execute(
      "discord.reply_message",
      { channel_id: latestMessage.channelId, message_id: latestMessage.id, content: sanitizeExternalText(replyText) },
      { caller: "cursor", cursorId: this.cursorId, cwd: process.cwd(), allowedAuthority: ["external_write"], allowedTools: ["discord.reply_message"] }
    );

    // 2. 只有 Owner 可触发长期记忆写入 (归类为 user_facts)
    if (latestMessage.author.trustLevel === "owner" && policy.intent === "memory_write" && this.context.memory) {
      const key = `discord_channel_memory_${latestMessage.channelId}`;
      const line = `[${new Date().toISOString()}] User: ${latestMessage.cleanContent}\nStelle: ${replyText}`;
      await this.context.tools.execute(
        "memory.write_long_term", 
        { key, value: line, layer: "user_facts" }, 
        { caller: "cursor", cursorId: this.cursorId, cwd: process.cwd(), allowedAuthority: ["safe_write"], allowedTools: ["memory.write_long_term"] }
      ).catch(() => {});
    }

    return {
      id: String(asRecord(result.data?.message).id || `reply-${Date.now()}`),
      channelId: latestMessage.channelId,
      author: { id: "bot", username: "Stelle", displayName: "Stelle", bot: true, trustLevel: "bot" },
      content: replyText, cleanContent: replyText, createdTimestamp: this.context.now(), trustedInput: false
    };
  }
}
