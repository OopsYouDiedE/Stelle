import type { ToolDefinition } from "../../agent/types.js";
import {
  fetchMessage,
  formatMessageSummary,
  resolveChannelId,
} from "./shared.js";

interface DiscordGetMessageParams {
  message_id: string;
  channel_id?: string;
}

const discordGetMessageTool: ToolDefinition<DiscordGetMessageParams> = {
  schema: {
    type: "function",
    function: {
      name: "discord_get_message",
      description:
        "Fetch a Discord message and return its content, metadata, attachments, embeds, and reference info.",
      parameters: {
        type: "object",
        properties: {
          message_id: {
            type: "string",
            description: "The Discord message ID to fetch.",
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
    const resolvedChannelId = resolveChannelId(channel_id, context?.conversationId);
    const message = await fetchMessage(resolvedChannelId, message_id);
    return JSON.stringify(
      {
        ok: true,
        message: formatMessageSummary(message),
      },
      null,
      2
    );
  },
};

export default discordGetMessageTool;
