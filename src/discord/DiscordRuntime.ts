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
import type {
  DiscordChannelSummary,
  DiscordMessageSummary,
  DiscordRuntime,
  DiscordRuntimeStatus,
} from "./types.js";

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
  return {
    id: message.id,
    channelId: message.channelId,
    guildId: message.guildId,
    author: {
      id: message.author.id,
      username: message.author.username,
      tag: message.author.tag,
      bot: message.author.bot,
    },
    content: message.content,
    cleanContent: message.cleanContent,
    createdTimestamp: message.createdTimestamp,
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
