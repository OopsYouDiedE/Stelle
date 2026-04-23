import type { ToolDefinition } from "../../agent/types.js";
import { fetchTextChannel, resolveChannelId } from "./shared.js";

interface DiscordSendMessageParams {
  content: string;
  channel_id?: string;
  mention_user_ids?: string[];
  reply_to_message_id?: string;
}

const discordSendMessageTool: ToolDefinition<DiscordSendMessageParams> = {
  schema: {
    type: "function",
    function: {
      name: "discord_send_message",
      description:
        "Send a message to a Discord channel, optionally mentioning users and replying to an earlier message.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The message content to send.",
          },
          channel_id: {
            type: "string",
            description:
              "Optional target channel ID. Defaults to the current conversation/channel when available.",
          },
          mention_user_ids: {
            type: "array",
            description: "Optional user IDs to mention in the outgoing message.",
            items: {
              type: "string",
            },
          },
          reply_to_message_id: {
            type: "string",
            description: "Optional message ID to reply to in the target channel.",
          },
        },
        required: ["content"],
      },
    },
  },
  async execute(
    { content, channel_id, mention_user_ids = [], reply_to_message_id },
    context
  ) {
    const resolvedChannelId = resolveChannelId(channel_id, context?.conversationId);
    const channel = await fetchTextChannel(resolvedChannelId);
    if (!channel.isSendable()) {
      throw new Error(`Channel "${resolvedChannelId}" is not sendable.`);
    }

    const mentions = mention_user_ids
      .filter((userId) => userId.trim().length > 0)
      .map((userId) => `<@${userId}>`);
    const finalContent = [...mentions, content].filter(Boolean).join(" ").trim();

    const message = await channel.send({
      content: finalContent,
      allowedMentions: {
        users: mention_user_ids,
        parse: [],
        repliedUser: false,
      },
      reply: reply_to_message_id
        ? {
            messageReference: reply_to_message_id,
            failIfNotExists: false,
          }
        : undefined,
    });

    return JSON.stringify(
      {
        ok: true,
        channelId: resolvedChannelId,
        messageId: message.id,
        content: message.content,
        mentionUserIds: mention_user_ids,
        replyToMessageId: reply_to_message_id ?? null,
        createdAt: message.createdAt.toISOString(),
      },
      null,
      2
    );
  },
};

export default discordSendMessageTool;
