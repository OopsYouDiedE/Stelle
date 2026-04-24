import type { ToolDefinition, ToolInputSchema, ToolResult } from "../types.js";
import { CursorRegistry } from "../core/CursorRegistry.js";
import { DiscordCursor } from "../cursors/discord/DiscordCursor.js";
import { sanitizeExternalText } from "../text/sanitize.js";
import { fail, sideEffects } from "./shared.js";

type ReadInput = Record<string, unknown>;
type SendInput = { channel_id: string; content: string; mention_user_ids?: string[]; reply_to_message_id?: string };
type ReplyInput = { channel_id: string; message_id: string; content: string };

const DISCORD_READ_EFFECTS = sideEffects({ networkAccess: true });
const DISCORD_WRITE_EFFECTS = sideEffects({
  externalVisible: true,
  networkAccess: true,
  affectsUserState: true,
});

const channelIdProperty = { type: "string", description: "Discord channel ID." } as const;
const messageIdProperty = (description = "Discord message ID.") => ({ type: "string", description }) as const;
const contentProperty = { type: "string", description: "Message content." } as const;
const messageLookupSchema: ToolInputSchema = {
  type: "object",
  properties: {
    channel_id: channelIdProperty,
    message_id: messageIdProperty(),
  },
  required: ["channel_id", "message_id"],
};

export function createDiscordCursorTools(cursors: CursorRegistry): ToolDefinition[] {
  return [
    createReadTool(cursors, {
      name: "cursor_status",
      summary: "Reads Discord runtime status and known channel snapshots.",
      whenToUse: "Use to inspect Discord Cursor connection and local state.",
      scopes: ["discord"],
      execute: async (cursor) => {
        const status = await cursor.discord.getStatus();
        return {
          ok: true,
          summary: `Discord connected=${status.connected}`,
          data: { status, channels: cursor.listChannelSnapshots() },
        };
      },
    }),
    createReadTool<{ guild_id?: string; include_threads?: boolean }>(cursors, {
      name: "cursor_list_channels",
      summary: "Lists accessible Discord channels.",
      whenToUse: "Use when selecting or verifying a Discord channel.",
      scopes: ["discord.channels"],
      inputSchema: {
        type: "object",
        properties: {
          guild_id: { type: "string", description: "Optional guild ID." },
          include_threads: { type: "boolean", description: "Whether to include threads." },
        },
      },
      execute: async (cursor, input) => {
        const channels = await cursor.discord.listChannels({
          guildId: input.guild_id,
          includeThreads: input.include_threads,
        });
        return {
          ok: true,
          summary: `Listed ${channels.length} Discord channels.`,
          data: { channels },
        };
      },
    }),
    createReadTool<{ channel_id: string; limit?: number; after?: string; before?: string }>(cursors, {
      name: "cursor_get_channel_history",
      summary: "Reads Discord message history for a channel.",
      whenToUse: "Use to inspect recent channel context.",
      scopes: ["discord.messages"],
      inputSchema: {
        type: "object",
        properties: {
          channel_id: { type: "string", description: "Discord channel ID." },
          limit: { type: "integer", description: "Maximum messages, default 20." },
          after: { type: "string", description: "Optional ISO lower bound." },
          before: { type: "string", description: "Optional ISO upper bound." },
        },
        required: ["channel_id"],
      },
      execute: async (cursor, input) => {
        const messages = await cursor.discord.getChannelHistory({
          channelId: input.channel_id,
          limit: input.limit,
          after: parseTimestamp(input.after),
          before: parseTimestamp(input.before),
        });
        return {
          ok: true,
          summary: `Read ${messages.length} Discord messages.`,
          data: { channelId: input.channel_id, messages },
        };
      },
    }),
    createReadTool<{ channel_id: string; message_id: string }>(cursors, {
      name: "cursor_get_message",
      summary: "Reads one Discord message.",
      whenToUse: "Use when exact message metadata or attachments are needed.",
      scopes: ["discord.messages"],
      inputSchema: messageLookupSchema,
      execute: async (cursor, input) => {
        const message = await cursor.discord.getMessage(input.channel_id, input.message_id);
        return { ok: true, summary: `Read Discord message ${message.id}.`, data: { message } };
      },
    }),
    createReadTool<{ channel_id: string; message_id: string }>(cursors, {
      name: "cursor_get_message_reference",
      summary: "Reads a Discord message and its referenced message.",
      whenToUse: "Use when a reply needs its parent context.",
      scopes: ["discord.messages"],
      inputSchema: messageLookupSchema,
      execute: async (cursor, input) => {
        const result = await cursor.discord.getMessageReference(input.channel_id, input.message_id);
        return { ok: true, summary: `Read Discord message reference for ${input.message_id}.`, data: result };
      },
    }),
    createWriteTool<ReplyInput>(cursors, {
      authorityClass: "cursor",
      name: "cursor_reply_mention",
      summary: "Replies to a Discord message only when that source message explicitly mentions the bot.",
      whenToUse: "Use for passive @reply behavior in the current Discord Cursor.",
      whenNotToUse: "Do not use for proactive sends, non-mention replies, announcements, or moderation.",
      scopes: ["discord.mention_reply"],
      inputSchema: replySchema("Mentioning message ID to reply to."),
      sideEffectType: "discord_mention_reply_sent",
      sideEffectSummary: (input) => `Replied to @mention in Discord channel ${input.channel_id}.`,
      execute: async (cursor, input) => {
        const status = await cursor.discord.getStatus();
        const sourceMessage = await cursor.discord.getMessage(input.channel_id, input.message_id);
        if (!cursor.canReplyToMention(sourceMessage, status.botUserId)) {
          return fail(
            "mention_required",
            "Discord Cursor can only reply when the source message explicitly mentions the bot."
          );
        }
        const message = await sendReply(cursor, input);
        return {
          ok: true,
          summary: `Replied to mentioning Discord message ${input.message_id}.`,
          data: { message, sourceMessage },
        };
      },
    }),
    createWriteTool<ReplyInput>(cursors, {
      authorityClass: "cursor",
      name: "cursor_reply_direct",
      summary: "Replies to a direct Discord message received by the bot.",
      whenToUse: "Use for passive DM replies in the current Discord Cursor.",
      whenNotToUse: "Do not use for guild messages, proactive sends, announcements, or moderation.",
      scopes: ["discord.dm_reply"],
      inputSchema: replySchema("Source DM message ID."),
      sideEffectType: "discord_dm_reply_sent",
      sideEffectSummary: (input) => `Replied to DM in Discord channel ${input.channel_id}.`,
      execute: async (cursor, input) => {
        const sourceMessage = await cursor.discord.getMessage(input.channel_id, input.message_id);
        if (sourceMessage.guildId) {
          return fail("dm_required", "Discord Cursor direct replies are allowed only for DM source messages.");
        }
        const message = await sendReply(cursor, input);
        return {
          ok: true,
          summary: `Replied to Discord DM ${input.message_id}.`,
          data: { message, sourceMessage },
        };
      },
    }),
    createWriteTool<SendInput>(cursors, {
      authorityClass: "stelle",
      name: "stelle_send_message",
      summary: "Sends a Discord message through the current Discord Cursor runtime.",
      whenToUse: "Use only when Core Mind or an approved higher authority decides to send externally visible text.",
      whenNotToUse: "Do not expose as a Cursor Tool or use for passive local processing.",
      scopes: ["discord.messages"],
      inputSchema: {
        type: "object",
        properties: {
          channel_id: channelIdProperty,
          content: contentProperty,
          mention_user_ids: { type: "array", items: { type: "string" }, description: "Optional user IDs to mention." },
          reply_to_message_id: { type: "string", description: "Optional message ID to reply to." },
        },
        required: ["channel_id", "content"],
      },
      sideEffectType: "discord_message_sent",
      sideEffectSummary: (input) => `Sent a message to Discord channel ${input.channel_id}.`,
      execute: async (cursor, input) => {
        const message = await cursor.discord.sendMessage({
          channelId: input.channel_id,
          content: visibleDiscordContent(input.content),
          mentionUserIds: input.mention_user_ids,
          replyToMessageId: input.reply_to_message_id,
        });
        return {
          ok: true,
          summary: `Sent Discord message ${message.id}.`,
          data: { message },
        };
      },
    }),
  ];
}

function getDiscordCursor(cursors: CursorRegistry, cursorId?: string): DiscordCursor | ToolResult {
  if (!cursorId) {
    return fail("missing_cursor_id", "Missing cursorId for Discord tool.");
  }
  const cursor = cursors.get(cursorId);
  if (!(cursor instanceof DiscordCursor)) {
    return fail("not_discord_cursor", `Cursor ${cursorId} is not a Discord Cursor.`);
  }
  return cursor;
}

function parseTimestamp(input: unknown): number | undefined {
  if (typeof input !== "string" || !input) return undefined;
  const timestamp = Date.parse(input);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid timestamp: ${input}`);
  }
  return timestamp;
}

function visibleDiscordContent(content: string): string {
  return sanitizeExternalText(content) || "[content removed after sanitization]";
}

async function sendReply(cursor: DiscordCursor, input: ReplyInput) {
  return cursor.discord.sendMessage({
    channelId: input.channel_id,
    content: visibleDiscordContent(input.content),
    replyToMessageId: input.message_id,
  });
}

function replySchema(messageIdDescription: string): ToolInputSchema {
  return {
    type: "object",
    properties: {
      channel_id: channelIdProperty,
      message_id: messageIdProperty(messageIdDescription),
      content: contentProperty,
    },
    required: ["channel_id", "message_id", "content"],
  };
}

function createReadTool<TInput extends ReadInput>(
  cursors: CursorRegistry,
  config: {
    name: string;
    summary: string;
    whenToUse: string;
    whenNotToUse?: string;
    scopes: string[];
    inputSchema?: ToolDefinition<TInput>["inputSchema"];
    execute: (cursor: DiscordCursor, input: TInput) => Promise<ToolResult> | ToolResult;
  }
): ToolDefinition<TInput> {
  return {
    identity: { namespace: "discord", name: config.name, authorityClass: "cursor", version: "0.1.0" },
    description: {
      summary: config.summary,
      whenToUse: config.whenToUse,
      whenNotToUse: config.whenNotToUse,
    },
    inputSchema: config.inputSchema ?? { type: "object", properties: {} },
    sideEffects: DISCORD_READ_EFFECTS,
    authority: { level: "read", scopes: config.scopes, requiresUserConfirmation: false },
    async execute(input, context) {
      const cursor = getDiscordCursor(cursors, context.cursorId);
      if (!(cursor instanceof DiscordCursor)) return cursor;
      return config.execute(cursor, input);
    },
  };
}

function createWriteTool<TInput extends ReadInput>(
  cursors: CursorRegistry,
  config: {
    authorityClass: "cursor" | "stelle";
    name: string;
    summary: string;
    whenToUse: string;
    whenNotToUse?: string;
    scopes: string[];
    inputSchema: ToolDefinition<TInput>["inputSchema"];
    sideEffectType: string;
    sideEffectSummary: (input: TInput) => string;
    execute: (cursor: DiscordCursor, input: TInput) => Promise<ToolResult> | ToolResult;
  }
): ToolDefinition<TInput> {
  return {
    identity: { namespace: "discord", name: config.name, authorityClass: config.authorityClass, version: "0.1.0" },
    description: {
      summary: config.summary,
      whenToUse: config.whenToUse,
      whenNotToUse: config.whenNotToUse,
    },
    inputSchema: config.inputSchema,
    sideEffects: DISCORD_WRITE_EFFECTS,
    authority: { level: "external_write", scopes: config.scopes, requiresUserConfirmation: false },
    async execute(input, context) {
      const cursor = getDiscordCursor(cursors, context.cursorId);
      if (!(cursor instanceof DiscordCursor)) return cursor;
      const result = await config.execute(cursor, input);
      if (!result.ok) return result;
      return {
        ...result,
        sideEffects: [
          {
            type: config.sideEffectType,
            summary: config.sideEffectSummary(input),
            visible: true,
            timestamp: Date.now(),
          },
        ],
      };
    },
  };
}
