import type { ToolDefinition } from "../../agent/types.js";
import {
  fetchMessage,
  formatMessageSummary,
  resolveChannelId,
} from "./shared.js";

interface DiscordGetMessageReferenceParams {
  message_id: string;
  channel_id?: string;
}

const discordGetMessageReferenceTool: ToolDefinition<DiscordGetMessageReferenceParams> = {
  schema: {
    type: "function",
    function: {
      name: "discord_get_message_reference",
      description:
        "Fetch the referenced message for a Discord message, or inspect the message if it has no reference.",
      parameters: {
        type: "object",
        properties: {
          message_id: {
            type: "string",
            description: "The Discord message ID to inspect.",
          },
          channel_id: {
            type: "string",
            description:
              "Optional channel ID. Defaults to the current conversation/channel when available.",
          },
        },
        required: ["message_id"],
      },
    },
  },
  async execute({ message_id, channel_id }, context) {
    const sourceChannelId = resolveChannelId(channel_id, context?.conversationId);
    const message = await fetchMessage(sourceChannelId, message_id);

    let referencedMessage: Record<string, unknown> | null = null;
    if (message.reference?.messageId && message.reference.channelId) {
      try {
        const target = await fetchMessage(
          message.reference.channelId,
          message.reference.messageId
        );
        referencedMessage = formatMessageSummary(target);
      } catch (error) {
        referencedMessage = {
          failed: true,
          reason: error instanceof Error ? error.message : String(error),
          channelId: message.reference.channelId,
          messageId: message.reference.messageId,
        };
      }
    }

    return JSON.stringify(
      {
        ok: true,
        sourceMessage: formatMessageSummary(message),
        referencedMessage,
      },
      null,
      2
    );
  },
};

export default discordGetMessageReferenceTool;
