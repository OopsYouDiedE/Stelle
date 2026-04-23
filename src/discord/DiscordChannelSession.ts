import type { ContextStreamItem } from "../types.js";
import type { DiscordChannelSnapshot, DiscordMessageSummary, DiscordWaitCondition } from "./types.js";

export interface DiscordChannelSessionConfig {
  botUserId?: string | null;
  historyMaxLen?: number;
  maxInputChars?: number;
  maxInputTokensTotal?: number;
}

const defaultSessionConfig: Required<Omit<DiscordChannelSessionConfig, "botUserId">> = {
  historyMaxLen: 80,
  maxInputChars: 6000,
  maxInputTokensTotal: 8000,
};

function secondsNow(): number {
  return Math.floor(Date.now() / 1000);
}

function roughlyCountTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export class DiscordChannelSession {
  readonly history: string[] = [];
  readonly activeUsers = new Map<string, number>();
  focus = "";
  intentSummary = "";
  waitCond?: DiscordWaitCondition;
  msgCount = 0;
  lastMsgTime?: number;
  lastMessageId?: string;
  lastAuthorId?: string;
  isProcessing = false;
  shutUpUntil?: number;
  msgCountSinceReview = 0;
  reviewCountSinceDistill = 0;
  guildId?: string | null;
  dmUserId?: string | null;

  private readonly config: Required<Omit<DiscordChannelSessionConfig, "botUserId">> & {
    botUserId?: string | null;
  };

  constructor(readonly channelId: string, config: DiscordChannelSessionConfig = {}) {
    this.config = {
      ...defaultSessionConfig,
      botUserId: config.botUserId ?? null,
      historyMaxLen: config.historyMaxLen ?? defaultSessionConfig.historyMaxLen,
      maxInputChars: config.maxInputChars ?? defaultSessionConfig.maxInputChars,
      maxInputTokensTotal: config.maxInputTokensTotal ?? defaultSessionConfig.maxInputTokensTotal,
    };
  }

  parseMessage(message: DiscordMessageSummary): boolean {
    if (message.channelId !== this.channelId) {
      throw new Error(`Message ${message.id} belongs to channel ${message.channelId}, not ${this.channelId}`);
    }
    if (message.content.length > this.config.maxInputChars) {
      return false;
    }

    const messageTimeSeconds = Math.floor(message.createdTimestamp / 1000);
    this.guildId = message.guildId ?? this.guildId ?? null;
    if (!this.guildId && !message.author.bot) this.dmUserId = message.author.id;
    this.activeUsers.set(message.author.id, messageTimeSeconds || secondsNow());

    const nickname = message.author.id === this.config.botUserId ? "[Stelle]" : message.author.username;
    this.history.push(...this.formatMessage(message, nickname));
    this.trimHistory();

    this.lastAuthorId = message.author.id;
    this.lastMsgTime = messageTimeSeconds;
    this.lastMessageId = message.id;
    this.msgCount += 1;
    this.msgCountSinceReview += 1;
    return true;
  }

  resetRuntimeState(): void {
    this.isProcessing = false;
    this.shutUpUntil = undefined;
    this.waitCond = undefined;
  }

  muteFor(seconds: number): void {
    this.shutUpUntil = secondsNow() + Math.max(0, seconds);
  }

  updateIntentSummary(input: { focus?: string; intentSummary?: string }): void {
    if (input.focus !== undefined) this.focus = input.focus;
    if (input.intentSummary !== undefined) this.intentSummary = input.intentSummary;
  }

  setWaitCondition(condition: DiscordWaitCondition): void {
    this.waitCond = condition;
  }

  clearWaitCondition(): void {
    this.waitCond = undefined;
  }

  snapshot(): DiscordChannelSnapshot {
    const lastLine = this.history.at(-1) ?? "";
    return {
      channelId: this.channelId,
      guildId: this.guildId ?? null,
      dmUserId: this.dmUserId ?? null,
      historySize: this.history.length,
      activeUserCount: this.activeUsers.size,
      focus: this.focus || null,
      intentSummary: this.intentSummary || null,
      waitConditionType: this.waitCond?.type ?? null,
      waitExpiresAt: this.waitCond?.expiresAt ?? null,
      msgCount: this.msgCount,
      lastMsgTime: this.lastMsgTime ?? null,
      lastMessageId: this.lastMessageId ?? null,
      lastMessageAt: this.lastMsgTime ? this.lastMsgTime * 1000 : null,
      lastAuthorId: this.lastAuthorId ?? null,
      isProcessing: this.isProcessing,
      shutUpUntil: this.shutUpUntil ?? null,
      msgCountSinceReview: this.msgCountSinceReview,
      reviewCountSinceDistill: this.reviewCountSinceDistill,
      summary: this.intentSummary || lastLine || `Discord channel ${this.channelId} has no messages yet.`,
      recentHistory: this.history.slice(-12),
    };
  }

  toContextStreamItem(cursorId: string): ContextStreamItem {
    const snapshot = this.snapshot();
    const header = [
      `Discord channel ${this.channelId}`,
      snapshot.focus ? `Focus: ${snapshot.focus}` : undefined,
      snapshot.intentSummary ? `Intent: ${snapshot.intentSummary}` : undefined,
      snapshot.waitConditionType ? `Waiting: ${snapshot.waitConditionType}` : undefined,
    ].filter(Boolean);

    return {
      id: `discord-session-${this.channelId}-${snapshot.msgCount}`,
      type: "summary",
      source: cursorId,
      timestamp: Date.now(),
      content: [...header, ...snapshot.recentHistory].join("\n"),
      trust: "cursor",
      metadata: {
        channelId: this.channelId,
        guildId: snapshot.guildId,
        dmUserId: snapshot.dmUserId,
        msgCount: snapshot.msgCount,
        historySize: snapshot.historySize,
        activeUserCount: snapshot.activeUserCount,
        lastAuthorId: snapshot.lastAuthorId,
        lastMessageId: snapshot.lastMessageId,
        discordSession: true,
      },
    };
  }

  private formatMessage(message: DiscordMessageSummary, nickname: string): string[] {
    const lines = [`[${formatTimestamp(message.createdTimestamp)}] ${nickname}: ${message.content || "(empty message)"}`];
    if (message.reference?.messageId) {
      lines.push(`  replied_to: ${message.reference.messageId}`);
    }
    for (const attachment of message.attachments ?? []) {
      lines.push(`  attachment: ${attachment.name ?? attachment.id} ${attachment.url}`);
    }
    for (const embed of message.embeds ?? []) {
      const title = embed.title ? `title=${embed.title}` : "";
      const description = embed.description ? `description=${embed.description}` : "";
      const url = embed.url ? `url=${embed.url}` : "";
      lines.push(`  embed: ${[title, description, url].filter(Boolean).join(" ")}`);
    }
    return lines;
  }

  private trimHistory(): void {
    while (this.history.length > this.config.historyMaxLen) this.history.shift();
    while (roughlyCountTokens(this.history.join("\n")) > this.config.maxInputTokensTotal && this.history.length > 1) {
      this.history.shift();
    }
  }
}

export class DiscordChannelSessionStore {
  private readonly sessions = new Map<string, DiscordChannelSession>();

  constructor(private readonly config: DiscordChannelSessionConfig = {}) {}

  get(channelId: string): DiscordChannelSession {
    let session = this.sessions.get(channelId);
    if (!session) {
      session = new DiscordChannelSession(channelId, this.config);
      this.sessions.set(channelId, session);
    }
    return session;
  }

  getExisting(channelId: string): DiscordChannelSession | undefined {
    return this.sessions.get(channelId);
  }

  list(): DiscordChannelSession[] {
    return [...this.sessions.values()];
  }

  snapshots(): DiscordChannelSnapshot[] {
    return this.list().map((session) => session.snapshot());
  }
}
