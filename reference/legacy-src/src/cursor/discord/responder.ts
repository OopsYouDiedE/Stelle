// === Imports ===
import { truncateText, sanitizeExternalText } from "../../utils/text.js";
import { asRecord } from "../../utils/json.js";
import type { DiscordMessageSummary } from "../../utils/discord.js";
import type { CursorContext } from "../types.js";
import type { DiscordReplyPolicy, DiscordToolResultView, DiscordChannelSession } from "./types.js";

/**
 * 模块：DiscordResponder (表达层)
 * 职责：回复生成、Discord 发送、记忆捕获、反思上报。
 */
// === Responder Layer ===
export class DiscordResponder {
  constructor(
    private readonly context: CursorContext,
    private readonly persona: string,
    private readonly cursorId: string,
  ) {}

  // === Response Generation ===
  public async respond(
    session: DiscordChannelSession,
    batch: DiscordMessageSummary[],
    policy: DiscordReplyPolicy,
    toolResults: DiscordToolResultView[],
  ): Promise<string> {
    if (!this.context.config.models.apiKey) return "API is offline.";

    const history = session.history
      .slice(-12)
      .map((m) => `${m.author.username}: ${m.cleanContent}`)
      .join("\n");
    const batchContent = batch.map((m) => `${m.author.username}: ${m.cleanContent}`).join("\n");
    const toolBlock = toolResults.length ? truncateText(JSON.stringify(toolResults, null, 2), 3000) : "(none)";

    // 重点修复 (P1): 显式指定 self_state 层，否则由于 memory.ts 默认 observations 导致无法读取
    const [subconscious, focus] = await Promise.all([
      this.context.memory?.readLongTerm("global_subconscious", "self_state").catch(() => null),
      this.context.memory?.readLongTerm("current_focus", "self_state").catch(() => null),
    ]);

    const prompt = [
      this.persona,
      subconscious ? `Internal subconscious guidance:\n${subconscious}` : undefined,
      focus ? `Current collective focus:\n${focus}` : undefined,
      "You are Layer 3 (Execution). Generate the final plain-text reply.",
      "Rules: No JSON, no internal chain-of-thought visible to users.",
      policy.needsThinking
        ? "Think carefully. Provide a deliberate, accurate answer."
        : "Give a fast, natural, direct answer.",
      `Intent: ${policy.intent}`,
      `Recent history:\n${history}`,
      `Tool context:\n${toolBlock}`,
      `Target messages to reply to:\n${batchContent}`,
    ]
      .filter(Boolean)
      .join("\n\n");

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

  // === Sending & Archiving ===
  public async sendAndArchive(
    latestMessage: DiscordMessageSummary,
    replyText: string,
    policy: DiscordReplyPolicy,
  ): Promise<DiscordMessageSummary> {
    // 1. 发送
    const result = await this.context.tools.execute(
      "discord.reply_message",
      { channel_id: latestMessage.channelId, message_id: latestMessage.id, content: sanitizeExternalText(replyText) },
      {
        caller: "cursor",
        cursorId: this.cursorId,
        cwd: process.cwd(),
        allowedAuthority: ["external_write"],
        allowedTools: ["discord.reply_message"],
      },
    );
    if (!result.ok) {
      throw new Error(`Discord reply failed: ${result.error?.message ?? result.summary}`);
    }
    const sentMessage = asRecord(result.data?.message);
    const sentId = String(sentMessage.id ?? "");
    if (!sentId) {
      throw new Error("Discord reply failed: tool returned no sent message id.");
    }

    // 2. 只有 Owner 可触发长期记忆写入 (归类为 user_facts)
    if (latestMessage.author.trustLevel === "owner" && policy.intent === "memory_write" && this.context.memory) {
      const key = `discord_channel_memory_${latestMessage.channelId}`;
      const line = `[${new Date().toISOString()}] User: ${latestMessage.cleanContent}\nStelle: ${replyText}`;
      await this.context.tools
        .execute(
          "memory.append_long_term",
          { key, value: line, layer: "user_facts" },
          {
            caller: "cursor",
            cursorId: this.cursorId,
            cwd: process.cwd(),
            allowedAuthority: ["safe_write"],
            allowedTools: ["memory.append_long_term"],
          },
        )
        .catch(() => {});
    }

    return {
      id: sentId,
      channelId: String(sentMessage.channelId ?? latestMessage.channelId),
      guildId: typeof sentMessage.guildId === "string" ? sentMessage.guildId : latestMessage.guildId,
      author: { id: "bot", username: "Stelle", displayName: "Stelle", bot: true, trustLevel: "bot" },
      content: replyText,
      cleanContent: replyText,
      createdTimestamp:
        typeof sentMessage.createdTimestamp === "number" ? sentMessage.createdTimestamp : this.context.now(),
      trustedInput: false,
    };
  }
}
