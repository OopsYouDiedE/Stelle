import type { Message, TextBasedChannel } from "discord.js";
import { getDiscordToolClient } from "../../cursors/discord/toolRuntime.js";

export function resolveChannelId(
  channelId: string | undefined,
  conversationId: string | undefined
): string {
  const resolved = channelId ?? conversationId;
  if (!resolved) {
    throw new Error("A Discord channel_id is required for this tool.");
  }
  return resolved;
}

export async function fetchTextChannel(channelId: string): Promise<TextBasedChannel> {
  const client = getDiscordToolClient();
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) {
    throw new Error(`Channel "${channelId}" is not a text-based channel.`);
  }
  return channel;
}

export async function fetchMessage(
  channelId: string,
  messageId: string
): Promise<Message> {
  const channel = await fetchTextChannel(channelId);
  if (!("messages" in channel)) {
    throw new Error(`Channel "${channelId}" does not support message fetching.`);
  }
  return channel.messages.fetch(messageId);
}

export function formatMessageSummary(message: Message): Record<string, unknown> {
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.author.id,
    authorTag: message.author.tag,
    createdAt: message.createdAt.toISOString(),
    content: message.content,
    reference: message.reference
      ? {
          guildId: message.reference.guildId ?? null,
          channelId: message.reference.channelId ?? null,
          messageId: message.reference.messageId ?? null,
        }
      : null,
    embeds: message.embeds.map((embed) => ({
      title: embed.title ?? null,
      description: embed.description ?? null,
      url: embed.url ?? null,
    })),
    attachments: [...message.attachments.values()].map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      contentType: attachment.contentType,
    })),
  };
}

export function isMessageWithinRange(
  message: Message,
  afterMs?: number,
  beforeMs?: number
): boolean {
  const ts = message.createdTimestamp;
  if (afterMs !== undefined && ts < afterMs) return false;
  if (beforeMs !== undefined && ts > beforeMs) return false;
  return true;
}

export function parseTimestamp(input: string | undefined): number | undefined {
  if (!input) return undefined;
  const ts = Date.parse(input);
  if (Number.isNaN(ts)) {
    throw new Error(`Invalid timestamp: "${input}"`);
  }
  return ts;
}
