/**
 * 模块：Discord runtime wrapper
 *
 * 运行逻辑：
 * - 负责 discord.js Client 生命周期：login、destroy、presence、messageCreate 监听。
 * - 把 Discord 原始对象转换为轻量 summary，交给 DiscordCursor 做人格判断。
 * - 只提供平台能力，不做“是否该回复”的语义判断。
 *
 * 主要方法：
 * - `login()` / `destroy()`：连接和关闭 Discord。
 * - `onMessage()`：注册消息回调。
 * - `sendMessage()` / `replyMessage()`：受工具层调用的发送能力。
 * - `formatDiscordMessage()`：把 discord.js Message 标准化。
 */
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

const threadTypes = new Set([ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread]);

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
  isMentioned?: boolean; // 新增：是否提到 Bot
  isDirectMessage?: boolean; // 新增：是否私聊
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
    size?: number;
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

export interface DiscordStatus {
  connected: boolean;
  botUserId?: string | null;
  guildCount?: number;
  lastError?: string;
}

export interface SendDiscordMessageInput {
  channelId: string;
  content: string;
  mentionUserIds?: string[];
  replyToMessageId?: string;
}

export type DiscordMessageHandler = (message: DiscordMessageSummary) => void | Promise<void>;

export class DiscordRuntime {
  private client: Client | null;
  private lastError: string | undefined;
  private readonly messageHandlers = new Set<DiscordMessageHandler>();

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
    const client = this.client ?? DiscordRuntime.createClient();
    this.client = client;
    client.on(Events.MessageCreate, (message) => {
      const summary = formatDiscordMessage(message);
      for (const handler of this.messageHandlers) {
        void Promise.resolve(handler(summary)).catch((error) => {
          this.lastError = error instanceof Error ? error.message : String(error);
          console.error(`[Stelle] Discord message handler failed: ${this.lastError}`);
        });
      }
    });
    await client.login(token);
    await onceClientReady(client);
  }

  async destroy(): Promise<void> {
    await this.client?.destroy();
    this.client = null;
  }

  onMessage(handler: DiscordMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  getStatusSync(): DiscordStatus {
    return {
      connected: Boolean(this.client?.isReady()),
      botUserId: this.client?.user?.id ?? null,
      guildCount: this.client?.guilds.cache.size ?? 0,
      lastError: this.lastError,
    };
  }

  async getStatus(): Promise<DiscordStatus> {
    const client = this.client;
    return {
      connected: Boolean(client?.isReady()),
      botUserId: client?.user?.id ?? null,
      guildCount: client?.guilds.cache.size ?? 0,
      lastError: this.lastError,
    };
  }

  async listChannels(options: { guildId?: string; includeThreads?: boolean } = {}): Promise<DiscordChannelSummary[]> {
    const client = this.requireClient();
    const guild =
      (options.guildId ? await client.guilds.fetch(options.guildId).catch(() => null) : null) ??
      client.guilds.cache.first() ??
      null;
    if (!guild) throw new Error("No accessible Discord guild is available.");

    await guild.channels.fetch();
    return guild.channels.cache
      .filter((channel) => {
        if (!channel) return false;
        if (!options.includeThreads && threadTypes.has(channel.type)) return false;
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

  async getChannelHistory(input: {
    channelId: string;
    limit?: number;
    after?: number;
    before?: number;
  }): Promise<DiscordMessageSummary[]> {
    const channel = await this.fetchTextChannel(input.channelId);
    if (!("messages" in channel)) throw new Error(`Channel "${input.channelId}" does not support message fetching.`);
    const limit = Math.max(1, Math.min(100, input.limit ?? 20));
    const messages = await channel.messages.fetch({ limit });
    return [...messages.values()]
      .filter((message) => {
        const timestamp = message.createdTimestamp;
        if (input.after !== undefined && timestamp < input.after) return false;
        if (input.before !== undefined && timestamp > input.before) return false;
        return true;
      })
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map(formatDiscordMessage);
  }

  async getMessage(channelId: string, messageId: string): Promise<DiscordMessageSummary> {
    return formatDiscordMessage(await this.fetchMessage(channelId, messageId));
  }

  async getMessageReference(channelId: string, messageId: string): Promise<{
    sourceMessage: DiscordMessageSummary;
    referencedMessage: DiscordMessageSummary | null;
  }> {
    const source = await this.fetchMessage(channelId, messageId);
    let referencedMessage: DiscordMessageSummary | null = null;
    if (source.reference?.channelId && source.reference.messageId) {
      referencedMessage = formatDiscordMessage(await this.fetchMessage(source.reference.channelId, source.reference.messageId));
    }
    return { sourceMessage: formatDiscordMessage(source), referencedMessage };
  }

  async sendMessage(input: SendDiscordMessageInput): Promise<DiscordMessageSummary> {
    const channel = await this.fetchTextChannel(input.channelId);
    if (!channel.isSendable()) throw new Error(`Channel "${input.channelId}" is not sendable.`);
    const mentionUserIds = input.mentionUserIds ?? [];
    const mentions = mentionUserIds.map((userId) => `<@${userId}>`);
    const content = [...mentions, input.content].filter(Boolean).join(" ").trim();
    const message = await channel.send({
      content,
      allowedMentions: {
        users: mentionUserIds,
        parse: [],
        repliedUser: false,
      },
      reply: input.replyToMessageId
        ? {
            messageReference: input.replyToMessageId,
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
      activities: [{ name: `window: ${options.window}${detail}`, type: ActivityType.Custom }],
    });
  }

  private async fetchTextChannel(channelId: string): Promise<TextBasedChannel> {
    const channel = await this.requireClient().channels.fetch(channelId);
    if (!channel?.isTextBased()) throw new Error(`Channel "${channelId}" is not text-based.`);
    return channel;
  }

  private async fetchMessage(channelId: string, messageId: string): Promise<Message> {
    const channel = await this.fetchTextChannel(channelId);
    if (!("messages" in channel)) throw new Error(`Channel "${channelId}" does not support message fetching.`);
    return channel.messages.fetch(messageId);
  }

  private requireClient(): Client {
    if (!this.client) throw new Error("Discord client is not configured.");
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
      size: attachment.size,
    })),
    embeds: message.embeds.map((embed) => ({
      title: embed.title ?? null,
      description: embed.description ?? null,
      url: embed.url ?? null,
    })),
  };
}

function onceClientReady(client: Client): Promise<void> {
  if (client.isReady()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    client.once(Events.ClientReady, () => resolve());
  });
}
