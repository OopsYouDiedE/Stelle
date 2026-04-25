import {
  ActivityType,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
  type TextBasedChannel,
} from "discord.js";
import type { ContextStreamItem } from "./types.js";

const threadTypes = new Set([
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
]);

function onceClientReady(client: Client): Promise<void> {
  if (client.isReady()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    client.once(Events.ClientReady, () => resolve());
  });
}

export class DiscordJsRuntime implements DiscordRuntime {
  private client: Client | null;
  private lastError: string | undefined;

  constructor(client?: Client) {
    this.client = client ?? null;
  }

  static createClient(): Client {
    return new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageTyping,
      ],
      partials: [Partials.Channel],
    });
  }

  async login(token: string): Promise<void> {
    const client = this.client ?? DiscordJsRuntime.createClient();
    this.client = client;
    await client.login(token);
    await onceClientReady(client);
  }

  async destroy(): Promise<void> {
    await this.client?.destroy();
    this.client = null;
  }

  async getStatus(): Promise<DiscordRuntimeStatus> {
    const client = this.client;
    return {
      connected: Boolean(client?.isReady()),
      botUserId: client?.user?.id ?? null,
      guildCount: client?.guilds.cache.size ?? 0,
      lastError: this.lastError,
    };
  }

  async listChannels(options?: { guildId?: string; includeThreads?: boolean }): Promise<DiscordChannelSummary[]> {
    const client = this.requireClient();
    const guild =
      (options?.guildId ? await client.guilds.fetch(options.guildId).catch(() => null) : null) ??
      client.guilds.cache.first() ??
      null;
    if (!guild) throw new Error("No accessible Discord guild is available.");

    await guild.channels.fetch();
    return guild.channels.cache
      .filter((channel) => {
        if (!channel) return false;
        if (!options?.includeThreads && threadTypes.has(channel.type)) return false;
        return true;
      })
      .map((channel) => ({
        id: channel.id,
        guildId: guild.id,
        name: "name" in channel ? channel.name : null,
        type: ChannelType[channel.type] ?? String(channel.type),
        parentId: "parentId" in channel ? channel.parentId ?? null : null,
        topic: "topic" in channel ? channel.topic ?? null : null,
        isTextBased: channel.isTextBased(),
        isSendable: channel.isTextBased() && channel.isSendable(),
      }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }

  async getChannelHistory(options: {
    channelId: string;
    limit?: number;
    after?: number;
    before?: number;
  }): Promise<DiscordMessageSummary[]> {
    const channel = await this.fetchTextChannel(options.channelId);
    if (!("messages" in channel)) {
      throw new Error(`Channel "${options.channelId}" does not support message fetching.`);
    }
    const limit = Math.max(1, Math.min(100, options.limit ?? 20));
    const messages = await channel.messages.fetch({ limit });
    return [...messages.values()]
      .filter((message) => {
        const ts = message.createdTimestamp;
        if (options.after !== undefined && ts < options.after) return false;
        if (options.before !== undefined && ts > options.before) return false;
        return true;
      })
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map(formatDiscordMessage);
  }

  async getMessage(channelId: string, messageId: string): Promise<DiscordMessageSummary> {
    return formatDiscordMessage(await this.fetchMessage(channelId, messageId));
  }

  async getMessageReference(channelId: string, messageId: string) {
    const source = await this.fetchMessage(channelId, messageId);
    let referencedMessage: DiscordMessageSummary | null = null;
    if (source.reference?.channelId && source.reference.messageId) {
      referencedMessage = formatDiscordMessage(
        await this.fetchMessage(source.reference.channelId, source.reference.messageId)
      );
    }
    return {
      sourceMessage: formatDiscordMessage(source),
      referencedMessage,
    };
  }

  async sendMessage(options: {
    channelId: string;
    content: string;
    mentionUserIds?: string[];
    replyToMessageId?: string;
  }): Promise<DiscordMessageSummary> {
    const channel = await this.fetchTextChannel(options.channelId);
    if (!channel.isSendable()) {
      throw new Error(`Channel "${options.channelId}" is not sendable.`);
    }

    const mentionUserIds = options.mentionUserIds ?? [];
    const mentions = mentionUserIds.map((userId) => `<@${userId}>`);
    const content = [...mentions, options.content].filter(Boolean).join(" ").trim();
    const message = await channel.send({
      content,
      allowedMentions: {
        users: mentionUserIds,
        parse: [],
        repliedUser: false,
      },
      reply: options.replyToMessageId
        ? {
            messageReference: options.replyToMessageId,
            failIfNotExists: false,
          }
        : undefined,
    });
    return formatDiscordMessage(message);
  }

  async setBotPresence(options: { window: string; detail?: string }): Promise<void> {
    const client = this.requireClient();
    const detail = options.detail ? ` - ${options.detail}` : "";
    client.user?.setPresence({
      status: "online",
      activities: [
        {
          name: `window: ${options.window}${detail}`,
          type: ActivityType.Custom,
        },
      ],
    });
  }

  private async fetchTextChannel(channelId: string): Promise<TextBasedChannel> {
    const channel = await this.requireClient().channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      throw new Error(`Channel "${channelId}" is not text-based.`);
    }
    return channel;
  }

  private async fetchMessage(channelId: string, messageId: string): Promise<Message> {
    const channel = await this.fetchTextChannel(channelId);
    if (!("messages" in channel)) {
      throw new Error(`Channel "${channelId}" does not support message fetching.`);
    }
    return channel.messages.fetch(messageId);
  }

  private requireClient(): Client {
    if (!this.client) {
      throw new Error("Discord client is not configured.");
    }
    return this.client;
  }
}

export function formatDiscordMessage(message: Message): DiscordMessageSummary {
  const ownerUserId = process.env.DISCORD_OWNER_USER_ID ?? null;
  const isBotOwner = Boolean(ownerUserId && message.author.id === ownerUserId);
  const trustLevel = isBotOwner ? "owner" : message.author.bot ? "bot" : "external";
  return {
    id: message.id,
    channelId: message.channelId,
    guildId: message.guildId,
    author: {
      id: message.author.id,
      username: message.author.username,
      displayName: message.member?.displayName ?? message.author.globalName ?? message.author.username,
      tag: message.author.tag,
      bot: message.author.bot,
      isBotOwner,
      trustLevel,
    },
    content: message.content,
    cleanContent: message.cleanContent,
    createdTimestamp: message.createdTimestamp,
    trustedInput: isBotOwner,
    mentionedUserIds: [...message.mentions.users.keys()],
    reference: message.reference
      ? {
          guildId: message.reference.guildId ?? null,
          channelId: message.reference.channelId ?? null,
          messageId: message.reference.messageId ?? null,
        }
      : null,
    attachments: [...message.attachments.values()].map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      contentType: attachment.contentType,
    })),
    embeds: message.embeds.map((embed) => ({
      title: embed.title ?? null,
      description: embed.description ?? null,
      url: embed.url ?? null,
    })),
  };
}

export interface DiscordUserSummary {
  id: string;
  username: string;
  displayName?: string | null;
  tag?: string;
  bot?: boolean;
  isBotOwner?: boolean;
  trustLevel?: "owner" | "bot" | "external";
}

export interface DiscordMessageSummary {
  id: string;
  channelId: string;
  guildId?: string | null;
  author: DiscordUserSummary;
  content: string;
  cleanContent?: string;
  createdTimestamp: number;
  trustedInput?: boolean;
  mentionedUserIds?: string[];
  reference?: {
    guildId?: string | null;
    channelId?: string | null;
    messageId?: string | null;
  } | null;
  attachments?: {
    id: string;
    name?: string | null;
    url: string;
    contentType?: string | null;
  }[];
  embeds?: {
    title?: string | null;
    description?: string | null;
    url?: string | null;
  }[];
}

export interface DiscordChannelSummary {
  id: string;
  guildId?: string | null;
  name?: string | null;
  type: string;
  parentId?: string | null;
  topic?: string | null;
  isTextBased: boolean;
  isSendable: boolean;
}

export interface DiscordRuntimeStatus {
  connected: boolean;
  botUserId?: string | null;
  guildCount?: number;
  lastError?: string;
}

export type DiscordAttentionState = "cold" | "engaged" | "waiting" | "cooldown" | "dormant" | "muted";
export type DiscordJudgeAction = "drop" | "wait" | "reply";
export type DiscordReactivationMode = "normal" | "direct_only";
export type DiscordWaitConditionType = "silence" | "gap" | "keyword" | "never";
export type DiscordReplyRouteHint = "cursor_only" | "escalation_allowed";

export interface DiscordStoredJudgeDecision {
  action: DiscordJudgeAction;
  interestMatched: boolean;
  reactivation: DiscordReactivationMode;
  focus: string;
  stance: string;
  angle: string;
  think?: string;
  triggerType: DiscordWaitConditionType;
  triggerValue?: number | string[] | null;
  expiresAfter: number;
  decidedAt: number;
}

export interface DiscordReplyIntent {
  mode: "direct" | "ambient";
  stance: string;
  angle: string;
  focus: string;
  recallUserId?: string | null;
  routeHint: DiscordReplyRouteHint;
  createdAt: number;
}

export interface DiscordWaitCondition {
  type: DiscordWaitConditionType;
  fireNow?: boolean;
  summary?: string;
  expiresAt?: number | null;
  conditionValue?: number | string[] | null;
  payload?: Record<string, unknown>;
}

export interface DiscordJudgeDecision {
  action: DiscordJudgeAction;
  interestMatched: boolean;
  reactivation: DiscordReactivationMode;
  attentionWindowSeconds: number;
  think?: string;
  focus: {
    topic: string;
    drifted: boolean;
  };
  trigger: {
    fireNow: boolean;
    conditionType: DiscordWaitConditionType;
    conditionValue?: number | string[] | null;
    expiresAfter: number;
  };
  intent: {
    stance: string;
    angle: string;
  };
  recallUserId?: string | null;
}

export interface DiscordChannelSnapshot {
  channelId: string;
  guildId?: string | null;
  dmUserId?: string | null;
  attentionState: DiscordAttentionState;
  attentionExpiresAt?: number | null;
  cooldownUntil?: number | null;
  historySize: number;
  activeUserCount: number;
  focus?: string | null;
  intentSummary?: string | null;
  waitConditionType?: string | null;
  waitExpiresAt?: number | null;
  lastJudgeDecision?: DiscordStoredJudgeDecision | null;
  currentReplyIntent?: DiscordReplyIntent | null;
  msgCount: number;
  lastMsgTime?: number | null;
  lastMessageId?: string | null;
  lastMessageAt?: number | null;
  lastAuthorId?: string | null;
  isProcessing: boolean;
  shutUpUntil?: number | null;
  msgCountSinceReview: number;
  reviewCountSinceDistill: number;
  segmentStartedAt?: number | null;
  segmentLastActiveAt?: number | null;
  segmentMessageCount: number;
  segmentReplyCount: number;
  segmentParticipants: string[];
  summary: string;
  recentHistory: string[];
  participantDirectory: string[];
}

export interface DiscordRuntime {
  getStatus(): Promise<DiscordRuntimeStatus>;
  listChannels(options?: { guildId?: string; includeThreads?: boolean }): Promise<DiscordChannelSummary[]>;
  getChannelHistory(options: {
    channelId: string;
    limit?: number;
    after?: number;
    before?: number;
  }): Promise<DiscordMessageSummary[]>;
  getMessage(channelId: string, messageId: string): Promise<DiscordMessageSummary>;
  getMessageReference(channelId: string, messageId: string): Promise<{
    sourceMessage: DiscordMessageSummary;
    referencedMessage: DiscordMessageSummary | null;
  }>;
  sendMessage(options: {
    channelId: string;
    content: string;
    mentionUserIds?: string[];
    replyToMessageId?: string;
  }): Promise<DiscordMessageSummary>;
  setBotPresence?(options: { window: string; detail?: string }): Promise<void>;
}

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

function msNow(): number {
  return Date.now();
}

function roughlyCountTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatClockMinute(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function normalizeInlineText(text: string | null | undefined): string {
  const compact = (text ?? "").replace(/\s+/g, " ").trim();
  return compact || "(empty message)";
}

export interface DiscordClosedSegment {
  channelId: string;
  guildId?: string | null;
  dmUserId?: string | null;
  focus?: string | null;
  summary: string;
  reason: string;
  startedAt: number;
  endedAt: number;
  messageCount: number;
  replyCount: number;
  participantIds: string[];
  history: string[];
}

export class DiscordChannelSession {
  readonly history: string[] = [];
  readonly activeUsers = new Map<string, number>();
  attentionState: DiscordAttentionState = "cold";
  attentionExpiresAt?: number;
  cooldownUntil?: number;
  focus = "";
  intentSummary = "";
  waitCond?: DiscordWaitCondition;
  msgCount = 0;
  msgCountSinceJudge = 0;
  lastMsgTime?: number;
  lastMessageId?: string;
  lastAuthorId?: string;
  isProcessing = false;
  shutUpUntil?: number;
  msgCountSinceReview = 0;
  reviewCountSinceDistill = 0;
  guildId?: string | null;
  dmUserId?: string | null;
  latestMessage?: DiscordMessageSummary;
  lastJudgeDecision?: DiscordStoredJudgeDecision;
  currentReplyIntent?: DiscordReplyIntent;
  segmentStartedAt?: number;
  segmentLastActiveAt?: number;
  segmentMessageCount = 0;
  segmentReplyCount = 0;
  private lastSummaryLine?: string;
  private readonly authorLabels = new Map<string, string>();
  private readonly labelOwners = new Map<string, string>();
  private readonly segmentParticipants = new Set<string>();
  private segmentLastIncludedMessageId?: string;

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

    const nickname = this.resolveAuthorLabel(message);
    const mergedWithPrevious =
      this.lastAuthorId === message.author.id &&
      this.lastMsgTime !== undefined &&
      messageTimeSeconds - this.lastMsgTime <= 120;
    this.history.push(...this.formatMessage(message, nickname, mergedWithPrevious));
    this.trimHistory();
    this.lastSummaryLine = this.formatSummaryLine(message, nickname);

    this.lastAuthorId = message.author.id;
    this.lastMsgTime = messageTimeSeconds;
    this.lastMessageId = message.id;
    this.latestMessage = message;
    if (this.segmentStartedAt) this.includeMessageInSegment(message);
    this.msgCount += 1;
    this.msgCountSinceJudge += 1;
    this.msgCountSinceReview += 1;
    return true;
  }

  resetRuntimeState(): void {
    this.isProcessing = false;
    this.shutUpUntil = undefined;
    this.waitCond = undefined;
    this.attentionState = "cold";
    this.attentionExpiresAt = undefined;
    this.cooldownUntil = undefined;
    this.currentReplyIntent = undefined;
  }

  muteFor(seconds: number): void {
    this.shutUpUntil = secondsNow() + Math.max(0, seconds);
  }

  isMuted(atSeconds = secondsNow()): boolean {
    return Boolean(this.shutUpUntil && atSeconds < this.shutUpUntil);
  }

  beginProcessing(): void {
    this.isProcessing = true;
    this.waitCond = undefined;
  }

  endProcessing(): void {
    this.isProcessing = false;
  }

  updateIntentSummary(input: { focus?: string; intentSummary?: string }): void {
    if (input.focus !== undefined) this.focus = input.focus;
    if (input.intentSummary !== undefined) this.intentSummary = input.intentSummary;
  }

  storeJudgeDecision(decision: DiscordStoredJudgeDecision, replyIntent?: DiscordReplyIntent): void {
    this.lastJudgeDecision = decision;
    this.currentReplyIntent = replyIntent;
    this.updateIntentSummary({
      focus: decision.focus,
      intentSummary: `${decision.stance}: ${decision.angle}`,
    });
  }

  getCurrentReplyIntent(): DiscordReplyIntent | undefined {
    return this.currentReplyIntent;
  }

  getLastJudgeDecision(): DiscordStoredJudgeDecision | undefined {
    return this.lastJudgeDecision;
  }

  engage(input: {
    focus?: string;
    intentSummary?: string;
    state?: "engaged" | "waiting";
    attentionWindowSeconds?: number;
    nowMs?: number;
  }): void {
    const nowMs = input.nowMs ?? msNow();
    this.updateIntentSummary(input);
    this.ensureSegment(nowMs);
    this.segmentLastActiveAt = nowMs;
    this.attentionState = input.state ?? "engaged";
    this.attentionExpiresAt = nowMs + Math.max(15, input.attentionWindowSeconds ?? 120) * 1000;
    this.cooldownUntil = undefined;
  }

  setWaitCondition(condition: DiscordWaitCondition): void {
    this.waitCond = condition;
    this.msgCountSinceJudge = 0;
    if (!this.isMuted()) this.attentionState = "waiting";
  }

  clearWaitCondition(): void {
    this.waitCond = undefined;
    this.msgCountSinceJudge = 0;
    this.currentReplyIntent = undefined;
  }

  hasActiveWaitCondition(nowMs = Date.now()): boolean {
    return Boolean(this.waitCond && (!this.waitCond.expiresAt || this.waitCond.expiresAt > nowMs));
  }

  expireWaitCondition(nowMs = Date.now()): boolean {
    if (!this.waitCond?.expiresAt || this.waitCond.expiresAt > nowMs) return false;
    this.clearWaitCondition();
    return true;
  }

  enterCooldown(seconds: number, nowMs = msNow()): void {
    this.waitCond = undefined;
    this.msgCountSinceJudge = 0;
    this.segmentLastActiveAt = nowMs;
    if (!this.guildId) {
      this.attentionState = "cold";
      this.cooldownUntil = undefined;
      this.attentionExpiresAt = undefined;
      return;
    }
    this.attentionState = "cooldown";
    this.cooldownUntil = nowMs + Math.max(5, seconds) * 1000;
  }

  syncAttentionState(
    nowMs = msNow(),
    idleDormantSeconds?: number
  ): "cooldown_expired" | "attention_expired" | "idle_timeout" | null {
    if (this.cooldownUntil && nowMs >= this.cooldownUntil) {
      this.cooldownUntil = undefined;
      this.attentionState = this.guildId ? "dormant" : "cold";
      this.attentionExpiresAt = undefined;
      this.clearWaitCondition();
      return "cooldown_expired";
    }
    if (
      this.attentionExpiresAt &&
      nowMs >= this.attentionExpiresAt &&
      (this.attentionState === "engaged" || this.attentionState === "waiting")
    ) {
      this.attentionExpiresAt = undefined;
      this.attentionState = this.guildId ? "dormant" : "cold";
      this.clearWaitCondition();
      return "attention_expired";
    }
    if (
      idleDormantSeconds &&
      this.lastMsgTime &&
      nowMs >= this.lastMsgTime * 1000 + idleDormantSeconds * 1000 &&
      this.hasOpenSegment()
    ) {
      this.attentionState = this.guildId ? "dormant" : "cold";
      this.attentionExpiresAt = undefined;
      this.cooldownUntil = undefined;
      this.clearWaitCondition();
      return "idle_timeout";
    }
    return null;
  }

  isDormant(): boolean {
    return this.attentionState === "dormant";
  }

  hasOpenSegment(): boolean {
    return Boolean(this.segmentStartedAt);
  }

  leaveDormant(): void {
    if (this.attentionState === "dormant") this.attentionState = "cold";
  }

  closeSegment(reason: string, endedAt = msNow()): DiscordClosedSegment | null {
    if (!this.segmentStartedAt) return null;
    const closed: DiscordClosedSegment = {
      channelId: this.channelId,
      guildId: this.guildId ?? null,
      dmUserId: this.dmUserId ?? null,
      focus: this.focus || null,
      summary:
        this.intentSummary ||
        this.focus ||
        this.lastSummaryLine ||
        `Discord segment in ${this.channelId} ended after ${this.segmentMessageCount} observed messages.`,
      reason,
      startedAt: this.segmentStartedAt,
      endedAt,
      messageCount: this.segmentMessageCount,
      replyCount: this.segmentReplyCount,
      participantIds: [...this.segmentParticipants],
      history: this.getRecentHistory(12),
    };
    this.segmentStartedAt = undefined;
    this.segmentLastActiveAt = undefined;
    this.segmentMessageCount = 0;
    this.segmentReplyCount = 0;
    this.segmentParticipants.clear();
    this.segmentLastIncludedMessageId = undefined;
    this.clearWaitCondition();
    this.focus = "";
    this.intentSummary = "";
    this.currentReplyIntent = undefined;
    return closed;
  }

  getLatestMessage(): DiscordMessageSummary | undefined {
    return this.latestMessage;
  }

  snapshot(): DiscordChannelSnapshot {
    const recentHistory = this.getRecentHistory(12);
    const participantDirectory = this.getParticipantDirectory(8);
    return {
      channelId: this.channelId,
      guildId: this.guildId ?? null,
      dmUserId: this.dmUserId ?? null,
      attentionState: this.isMuted() ? "muted" : this.attentionState,
      attentionExpiresAt: this.attentionExpiresAt ?? null,
      cooldownUntil: this.cooldownUntil ?? null,
      historySize: this.history.length,
      activeUserCount: this.activeUsers.size,
      focus: this.focus || null,
      intentSummary: this.intentSummary || null,
      waitConditionType: this.waitCond?.type ?? null,
      waitExpiresAt: this.waitCond?.expiresAt ?? null,
      lastJudgeDecision: this.lastJudgeDecision ?? null,
      currentReplyIntent: this.currentReplyIntent ?? null,
      msgCount: this.msgCount,
      lastMsgTime: this.lastMsgTime ?? null,
      lastMessageId: this.lastMessageId ?? null,
      lastMessageAt: this.lastMsgTime ? this.lastMsgTime * 1000 : null,
      lastAuthorId: this.lastAuthorId ?? null,
      isProcessing: this.isProcessing,
      shutUpUntil: this.shutUpUntil ?? null,
      msgCountSinceReview: this.msgCountSinceReview,
      reviewCountSinceDistill: this.reviewCountSinceDistill,
      segmentStartedAt: this.segmentStartedAt ?? null,
      segmentLastActiveAt: this.segmentLastActiveAt ?? null,
      segmentMessageCount: this.segmentMessageCount,
      segmentReplyCount: this.segmentReplyCount,
      segmentParticipants: [...this.segmentParticipants],
      summary:
        this.intentSummary ||
        this.waitCond?.summary ||
        this.lastSummaryLine ||
        `Discord channel ${this.channelId} has no messages yet.`,
      recentHistory,
      participantDirectory,
    };
  }

  toContextStreamItem(cursorId: string): ContextStreamItem {
    const snapshot = this.snapshot();
    const header = [
      `Discord channel ${this.channelId}`,
      `Attention: ${snapshot.attentionState}`,
      snapshot.focus ? `Focus: ${snapshot.focus}` : undefined,
      snapshot.intentSummary ? `Intent: ${snapshot.intentSummary}` : undefined,
      snapshot.waitConditionType ? `Waiting: ${snapshot.waitConditionType}` : undefined,
    ].filter(Boolean);

    return {
      id: `discord-session-${this.channelId}-${snapshot.msgCount}`,
      type: "summary",
      source: cursorId,
      timestamp: Date.now(),
      content: [
        ...header,
        ...snapshot.recentHistory,
        ...(snapshot.participantDirectory.length
          ? ["", "Recent participants (nickname => id):", ...snapshot.participantDirectory]
          : []),
      ].join("\n"),
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

  private resolveAuthorLabel(message: DiscordMessageSummary): string {
    if (message.author.id === this.config.botUserId || message.author.bot) return "[Stelle]";
    if (message.author.isBotOwner) return "[Owner]";
    const existing = this.authorLabels.get(message.author.id);
    if (existing) return existing;

    const base =
      normalizeInlineText(message.author.displayName || message.author.username || message.author.id).replace(
        /^\(empty message\)$/,
        "member"
      );
    const candidates = [
      base,
      `${base} (@${message.author.username})`,
      `${base} (${message.author.id.slice(-4)})`,
    ];

    let label = candidates.find((candidate) => this.isLabelAvailable(candidate, message.author.id));
    if (!label) {
      for (let index = 2; index < 1000; index += 1) {
        const next = `${base}${index}`;
        if (this.isLabelAvailable(next, message.author.id)) {
          label = next;
          break;
        }
      }
    }

    const resolved = label ?? `${base}-${message.author.id.slice(-6)}`;
    this.authorLabels.set(message.author.id, resolved);
    this.labelOwners.set(resolved, message.author.id);
    return resolved;
  }

  private isLabelAvailable(label: string, authorId: string): boolean {
    const owner = this.labelOwners.get(label);
    return !owner || owner === authorId;
  }

  private formatSummaryLine(message: DiscordMessageSummary, nickname: string): string {
    return `[${formatClockMinute(message.createdTimestamp)}] ${this.messagePrefix(message)}${nickname}: ${this.messageText(message)}`;
  }

  private messageText(message: DiscordMessageSummary): string {
    return normalizeInlineText(message.cleanContent || message.content);
  }

  private formatMessage(message: DiscordMessageSummary, nickname: string, mergeWithPrevious: boolean): string[] {
    const lines = [
      mergeWithPrevious
        ? `  ${this.messageText(message)}`
        : `[${formatClockMinute(message.createdTimestamp)}] ${this.messagePrefix(message)}${nickname}: ${this.messageText(message)}`,
    ];
    const detailIndent = mergeWithPrevious ? "    " : "  ";
    if (message.reference?.messageId) {
      lines.push(`${detailIndent}reply ${message.reference.messageId}`);
    }
    for (const attachment of message.attachments ?? []) {
      lines.push(`${detailIndent}attachment ${attachment.name ?? attachment.id} ${attachment.url}`);
    }
    for (const embed of message.embeds ?? []) {
      const title = embed.title ? `title=${embed.title}` : "";
      const description = embed.description ? `description=${embed.description}` : "";
      const url = embed.url ? `url=${embed.url}` : "";
      lines.push(`${detailIndent}embed ${[title, description, url].filter(Boolean).join(" ")}`);
    }
    return lines;
  }

  private getRecentHistory(maxLines: number): string[] {
    const recent = this.history.slice(-maxLines);
    while (recent.length > 1 && recent[0]?.startsWith("  ")) recent.shift();
    return recent;
  }

  private getParticipantDirectory(maxEntries: number): string[] {
    const recent = [...this.activeUsers.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, maxEntries);
    const lines = recent.map(([authorId]) => {
      const label = this.authorLabels.get(authorId) ?? authorId;
      const ownerSuffix = label === "[Owner]" ? " [trusted-owner]" : "";
      return `${label}${ownerSuffix} => ${authorId}`;
    });
    const remaining = this.activeUsers.size - recent.length;
    if (remaining > 0) lines.push(`... ${remaining} more`);
    return lines;
  }

  private messagePrefix(message: DiscordMessageSummary): string {
    if (message.author.isBotOwner) return "[trusted-owner] ";
    if (message.author.bot) return "[bot] ";
    return "[untrusted] ";
  }

  private shiftHistoryBlock(): void {
    if (this.history.length === 0) return;
    this.history.shift();
    while (this.history.length > 0 && this.history[0]?.startsWith("  ")) {
      this.history.shift();
    }
  }

  private trimHistory(): void {
    while (this.history.length > this.config.historyMaxLen) this.shiftHistoryBlock();
    while (roughlyCountTokens(this.history.join("\n")) > this.config.maxInputTokensTotal && this.history.length > 1) {
      this.shiftHistoryBlock();
    }
  }

  private ensureSegment(nowMs: number): void {
    if (this.segmentStartedAt) return;
    this.segmentStartedAt = this.latestMessage?.createdTimestamp ?? nowMs;
    this.segmentLastActiveAt = nowMs;
    this.segmentMessageCount = 0;
    this.segmentReplyCount = 0;
    this.segmentParticipants.clear();
    this.segmentLastIncludedMessageId = undefined;
    if (this.latestMessage) this.includeMessageInSegment(this.latestMessage);
  }

  private includeMessageInSegment(message: DiscordMessageSummary): void {
    if (this.segmentLastIncludedMessageId === message.id) return;
    this.segmentLastIncludedMessageId = message.id;
    this.segmentLastActiveAt = message.createdTimestamp;
    if (message.author.id === this.config.botUserId || message.author.bot) {
      this.segmentReplyCount += 1;
      return;
    }
    this.segmentMessageCount += 1;
    this.segmentParticipants.add(message.author.id);
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
