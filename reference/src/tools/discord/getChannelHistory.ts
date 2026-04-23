import type { Message } from "discord.js";
import type { ToolDefinition } from "../../agent/types.js";
import {
  fetchTextChannel,
  formatMessageSummary,
  isMessageWithinRange,
  parseTimestamp,
  resolveChannelId,
} from "./shared.js";

interface DiscordGetChannelHistoryParams {
  channel_id?: string;
  limit?: number;
  after?: string;
  before?: string;
}

async function collectChannelHistory(
  channelId: string,
  limit: number,
  afterMs?: number,
  beforeMs?: number
) {
  const channel = await fetchTextChannel(channelId);
  if (!("messages" in channel)) {
    throw new Error(`Channel "${channelId}" does not support message fetching.`);
  }

  const out: Message[] = [];
  let beforeId: string | undefined;
  while (out.length < limit) {
    const batch: Map<string, Message> | any = await channel.messages.fetch({
      limit: Math.min(100, limit - out.length),
      before: beforeId,
    });
    if (!batch.size) break;

    let oldestId: string | undefined;
    for (const message of batch.values() as Iterable<Message>) {
      oldestId = message.id;
      if (!isMessageWithinRange(message, afterMs, beforeMs)) {
        if (afterMs !== undefined && message.createdTimestamp < afterMs) {
          beforeId = undefined;
          break;
        }
        continue;
      }
      out.push(message);
      if (out.length >= limit) break;
    }

    if (!oldestId || batch.size < Math.min(100, limit - out.length)) break;
    beforeId = oldestId;
    if (afterMs !== undefined) {
      const oldest = batch.get(oldestId);
      if (oldest && oldest.createdTimestamp < afterMs) break;
    }
  }

  out.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return out;
}

const discordGetChannelHistoryTool: ToolDefinition<DiscordGetChannelHistoryParams> = {
  schema: {
    type: "function",
    function: {
      name: "discord_get_channel_history",
      description:
        "Fetch Discord message history for a channel, optionally constrained by a time range.",
      parameters: {
        type: "object",
        properties: {
          channel_id: {
            type: "string",
            description:
              "Optional channel ID. Defaults to the current conversation/channel when available.",
          },
          limit: {
            type: "integer",
            description: "Maximum number of messages to return. Defaults to 20.",
          },
          after: {
            type: "string",
            description:
              "Optional ISO timestamp. Only messages on or after this time are returned.",
          },
          before: {
            type: "string",
            description:
              "Optional ISO timestamp. Only messages on or before this time are returned.",
          },
        },
      },
    },
  },
  async execute({ channel_id, limit = 20, after, before }, context) {
    const resolvedChannelId = resolveChannelId(channel_id, context?.conversationId);
    const afterMs = parseTimestamp(after);
    const beforeMs = parseTimestamp(before);
    const clampedLimit = Math.max(1, Math.min(100, Number(limit) || 20));

    const messages = await collectChannelHistory(
      resolvedChannelId,
      clampedLimit,
      afterMs,
      beforeMs
    );

    return JSON.stringify(
      {
        ok: true,
        channelId: resolvedChannelId,
        limit: clampedLimit,
        after: after ?? null,
        before: before ?? null,
        count: messages.length,
        messages: messages.map(formatMessageSummary),
      },
      null,
      2
    );
  },
};

export default discordGetChannelHistoryTool;
