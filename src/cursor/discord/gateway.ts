// === Imports ===
import { asRecord } from "../../utils/json.js";
import type { DiscordMessageSummary } from "../../utils/discord.js";
import type { CursorContext } from "../types.js";
import type { DiscordChannelSession } from "./types.js";

/**
 * 模块：DiscordGateway (物理感知层)
 * 职责：Session 管理、消息过滤、防抖缓冲、进场节奏控制。
 */
// === Gateway Layer ===
export class DiscordGateway {
  private readonly sessions = new Map<string, DiscordChannelSession>();
  private cachedBotUserId: string | null = null;

  constructor(private readonly context: CursorContext) {}

  // === Filtering & Buffering ===
  public async filterAndBuffer(
    message: DiscordMessageSummary,
    onReady: (
      session: DiscordChannelSession,
      batch: DiscordMessageSummary[],
      isDirectMention: boolean,
    ) => Promise<void>,
  ): Promise<{ observed: boolean; reason: string }> {
    if (message.author.bot || !message.content.trim()) {
      return { observed: false, reason: "ignored invalid/bot message" };
    }

    const session = this.getOrCreateSession(message);
    const botUserId = await this.getBotUserId();
    const mentioned = Boolean(botUserId && message.mentionedUserIds?.includes(botUserId));
    const isDirectMention = !message.guildId || mentioned;
    const isDirectedAtStelle = isDirectMention || this.isDirectedAtStelle(message);

    // 基础过滤
    if (message.guildId && !mentioned && !this.isChannelActivated(message.channelId)) {
      return { observed: true, reason: "channel not activated" };
    }
    if (!isDirectMention && !this.context.config.discord.ambientEnabled) {
      return { observed: true, reason: "ambient disabled" };
    }

    // 记入会话历史 (感知不致盲)
    this.appendHistory(session, message);

    if (!isDirectedAtStelle) {
      return { observed: true, reason: "observed only" };
    }

    const now = this.context.now();
    if (session.mode !== "active" && session.modeExpiresAt && session.modeExpiresAt <= now) {
      session.mode = "active";
      session.modeExpiresAt = undefined;
    }
    const isSilentMode = session.mode !== "active" && session.modeExpiresAt && session.modeExpiresAt > now;

    // 冷却检查
    if (session.cooldownUntil && session.cooldownUntil > now && !isDirectMention) {
      return { observed: true, reason: "cooldown active" };
    }

    // 压入缓冲池
    if (!session.inbox.includes(message)) {
      session.inbox.push(message);
    }

    // 动态延迟计算
    let delay = isDirectMention ? 200 : isSilentMode ? 8000 : 3000;
    if (message.content.length > 200) delay = 500;

    if (session.debounceTimer) clearTimeout(session.debounceTimer);
    session.debounceTimer = setTimeout(async () => {
      if (session.processing || session.inbox.length === 0) return;

      const batch = [...session.inbox];
      session.inbox = [];

      // 潜水过滤
      const isShortNoise = batch.length < 3 && batch.every((m) => (m.cleanContent?.length || m.content.length) < 20);
      if (isSilentMode && !isDirectMention && isShortNoise) {
        return;
      }

      session.processing = true;
      try {
        await onReady(session, batch, isDirectMention);
      } finally {
        session.processing = false;
        if (session.inbox.length > 0) {
          // 如果处理期间又有新消息，递归处理
          void this.filterAndBuffer(session.inbox[0], onReady);
        }
      }
    }, delay);

    return { observed: true, reason: isSilentMode ? "patiently observing" : "buffering context" };
  }

  // === Session Management ===
  private getOrCreateSession(message: DiscordMessageSummary): DiscordChannelSession {
    let session = this.sessions.get(message.channelId);
    if (!session) {
      session = {
        channelId: message.channelId,
        guildId: message.guildId,
        history: [],
        inbox: [],
        processing: false,
        mode: "active",
      };
      this.sessions.set(message.channelId, session);
    }
    return session;
  }

  public getSessionCount(): number {
    return this.sessions.size;
  }

  private appendHistory(session: DiscordChannelSession, message: DiscordMessageSummary) {
    session.history.push(message);
    if (session.history.length > 50) session.history.shift();
  }

  // === Internal Checks ===
  private async getBotUserId(): Promise<string | null> {
    if (this.cachedBotUserId) return this.cachedBotUserId;
    const result = await this.context.tools.execute(
      "discord.status",
      {},
      {
        caller: "system",
        cwd: process.cwd(),
        allowedAuthority: ["readonly"],
        allowedTools: ["discord.status"],
      },
    );

    if (result.ok && result.data?.status) {
      const status = asRecord(result.data.status);
      this.cachedBotUserId = String(status.botUserId || "") || null;
    }
    return this.cachedBotUserId;
  }

  private isChannelActivated(channelId: string): boolean {
    const channels = asRecord(this.context.config.rawYaml.channels);
    return asRecord(channels[channelId]).activated === true;
  }

  private isDirectedAtStelle(message: DiscordMessageSummary): boolean {
    return /(stelle|core\s*mind|cursor|bot|大脑|光标)/i.test(message.cleanContent || message.content);
  }
}
