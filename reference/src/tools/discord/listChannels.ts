import { ChannelType } from "discord.js";
import type { ToolDefinition } from "../../agent/types.js";
import { getDiscordToolClient } from "../../cursors/discord/toolRuntime.js";

interface DiscordListChannelsParams {
  guild_id?: string;
  include_threads?: boolean;
}

const threadTypes = new Set([
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
]);

const discordListChannelsTool: ToolDefinition<DiscordListChannelsParams> = {
  schema: {
    type: "function",
    function: {
      name: "discord_list_channels",
      description:
        "List accessible Discord channels for a guild, including whether they are text-capable and sendable.",
      parameters: {
        type: "object",
        properties: {
          guild_id: {
            type: "string",
            description:
              "Optional guild ID. Defaults to the first available guild in the current bot session.",
          },
          include_threads: {
            type: "boolean",
            description:
              "Whether to include Discord thread channels in the result. Defaults to false.",
          },
        },
      },
    },
  },
  async execute({ guild_id, include_threads = false }) {
    const client = getDiscordToolClient();
    const guild =
      (guild_id ? await client.guilds.fetch(guild_id).catch(() => null) : null) ??
      client.guilds.cache.first() ??
      null;

    if (!guild) {
      throw new Error("No accessible Discord guild is available for listing channels.");
    }

    await guild.channels.fetch();
    const channels = guild.channels.cache
      .filter((channel) => {
        if (!channel) return false;
        if (!include_threads && threadTypes.has(channel.type)) return false;
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
      .sort((a, b) => {
        const aName = a.name ?? "";
        const bName = b.name ?? "";
        return aName.localeCompare(bName);
      });

    return JSON.stringify(
      {
        ok: true,
        guildId: guild.id,
        guildName: guild.name,
        count: channels.length,
        channels,
      },
      null,
      2
    );
  },
};

export default discordListChannelsTool;
