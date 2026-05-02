import { z } from "zod";
import type { DiscordRuntime } from "../../windows/discord/runtime.js";
import { sanitizeExternalText } from "../../utils/text.js";
import { ok, sideEffects } from "../types.js";
import type { ToolDefinition } from "../types.js";
import type { ToolRegistryDeps } from "./deps.js";

export function createDiscordTools(deps: ToolRegistryDeps): ToolDefinition[] {
  const discordRequired = (): DiscordRuntime => {
    if (!deps.discord) throw new Error("Discord runtime is not configured.");
    return deps.discord;
  };

  return [
    {
      name: "discord.status",
      title: "Discord Status",
      description: "Read Discord runtime connection status.",
      authority: "readonly",
      inputSchema: z.object({}),
      sideEffects: sideEffects({ networkAccess: true }),
      async execute() {
        return ok("Discord status read.", { status: await discordRequired().getStatus() });
      },
    },
    {
      name: "discord.get_message",
      title: "Get Discord Message",
      description: "Read a Discord message by channel and message ID.",
      authority: "readonly",
      inputSchema: z.object({ channel_id: z.string(), message_id: z.string() }),
      sideEffects: sideEffects({ networkAccess: true }),
      async execute(input) {
        const message = await discordRequired().getMessage(input.channel_id, input.message_id);
        return ok(`Read Discord message ${message.id}.`, { message });
      },
    },
    {
      name: "discord.get_channel_history",
      title: "Get Discord Channel History",
      description: "Read recent Discord channel history.",
      authority: "readonly",
      inputSchema: z.object({ channel_id: z.string(), limit: z.number().int().min(1).max(100).optional().default(20) }),
      sideEffects: sideEffects({ networkAccess: true }),
      async execute(input) {
        const messages = await discordRequired().getChannelHistory({ channelId: input.channel_id, limit: input.limit });
        return ok(`Read ${messages.length} Discord messages.`, { messages });
      },
    },
    {
      name: "discord.reply_message",
      title: "Reply Discord Message",
      description: "Reply to a specific Discord message.",
      authority: "external_write",
      inputSchema: z.object({ channel_id: z.string(), message_id: z.string(), content: z.string().min(1) }),
      sideEffects: sideEffects({ externalVisible: true, networkAccess: true, affectsUserState: true }),
      async execute(input) {
        const message = await discordRequired().sendMessage({
          channelId: input.channel_id,
          replyToMessageId: input.message_id,
          content: sanitizeExternalText(input.content),
        });
        return {
          ...ok(`Replied with Discord message ${message.id}.`, { message }),
          sideEffects: [
            { type: "discord_reply_sent", summary: `Sent reply ${message.id}.`, visible: true, timestamp: Date.now() },
          ],
        };
      },
    },
    {
      name: "discord.send_message",
      title: "Send Discord Message",
      description: "Send a Discord message to a channel.",
      authority: "external_write",
      inputSchema: z.object({
        channel_id: z.string(),
        content: z.string().min(1),
        mention_user_ids: z.array(z.string()).optional(),
        reply_to_message_id: z.string().optional(),
      }),
      sideEffects: sideEffects({ externalVisible: true, networkAccess: true, affectsUserState: true }),
      async execute(input) {
        const message = await discordRequired().sendMessage({
          channelId: input.channel_id,
          content: sanitizeExternalText(input.content),
          mentionUserIds: input.mention_user_ids,
          replyToMessageId: input.reply_to_message_id,
        });
        return {
          ...ok(`Sent Discord message ${message.id}.`, { message }),
          sideEffects: [
            {
              type: "discord_message_sent",
              summary: `Sent message ${message.id}.`,
              visible: true,
              timestamp: Date.now(),
            },
          ],
        };
      },
    },
  ];
}
