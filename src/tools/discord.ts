import type { ToolDefinition, ToolResult } from "../types.js";
import { CursorRegistry } from "../core/CursorRegistry.js";
import { DiscordCursor } from "../cursors/discord/DiscordCursor.js";
import { sanitizeExternalText } from "../text/sanitize.js";

function getDiscordCursor(cursors: CursorRegistry, cursorId?: string): DiscordCursor | ToolResult {
  if (!cursorId) {
    return {
      ok: false,
      summary: "Missing cursorId for Discord tool.",
      error: { code: "missing_cursor_id", message: "Missing cursorId for Discord tool.", retryable: false },
    };
  }
  const cursor = cursors.get(cursorId);
  if (!(cursor instanceof DiscordCursor)) {
    return {
      ok: false,
      summary: `Cursor ${cursorId} is not a Discord Cursor.`,
      error: { code: "not_discord_cursor", message: `Cursor ${cursorId} is not a Discord Cursor.`, retryable: false },
    };
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
  return sanitizeExternalText(content) || "[内容已过滤]";
}

export function createDiscordCursorTools(cursors: CursorRegistry): ToolDefinition[] {
  const statusTool: ToolDefinition = {
    identity: { namespace: "discord", name: "cursor_status", authorityClass: "cursor", version: "0.1.0" },
    description: {
      summary: "Reads Discord runtime status and known channel snapshots.",
      whenToUse: "Use to inspect Discord Cursor connection and local state.",
    },
    inputSchema: { type: "object", properties: {} },
    sideEffects: noSideEffects(true),
    authority: { level: "read", scopes: ["discord"], requiresUserConfirmation: false },
    async execute(_input, context) {
      const cursor = getDiscordCursor(cursors, context.cursorId);
      if (!(cursor instanceof DiscordCursor)) return cursor;
      const status = await cursor.discord.getStatus();
      return {
        ok: true,
        summary: `Discord connected=${status.connected}`,
        data: { status, channels: cursor.listChannelSnapshots() },
      };
    },
  };

  const listChannelsTool: ToolDefinition<{ guild_id?: string; include_threads?: boolean }> = {
    identity: { namespace: "discord", name: "cursor_list_channels", authorityClass: "cursor", version: "0.1.0" },
    description: {
      summary: "Lists accessible Discord channels.",
      whenToUse: "Use when selecting or verifying a Discord channel.",
    },
    inputSchema: {
      type: "object",
      properties: {
        guild_id: { type: "string", description: "Optional guild ID." },
        include_threads: { type: "boolean", description: "Whether to include threads." },
      },
    },
    sideEffects: noSideEffects(true),
    authority: { level: "read", scopes: ["discord.channels"], requiresUserConfirmation: false },
    async execute(input, context) {
      const cursor = getDiscordCursor(cursors, context.cursorId);
      if (!(cursor instanceof DiscordCursor)) return cursor;
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
  };

  const historyTool: ToolDefinition<{ channel_id: string; limit?: number; after?: string; before?: string }> = {
    identity: { namespace: "discord", name: "cursor_get_channel_history", authorityClass: "cursor", version: "0.1.0" },
    description: {
      summary: "Reads Discord message history for a channel.",
      whenToUse: "Use to inspect recent channel context.",
    },
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
    sideEffects: noSideEffects(true),
    authority: { level: "read", scopes: ["discord.messages"], requiresUserConfirmation: false },
    async execute(input, context) {
      const cursor = getDiscordCursor(cursors, context.cursorId);
      if (!(cursor instanceof DiscordCursor)) return cursor;
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
  };

  const getMessageTool: ToolDefinition<{ channel_id: string; message_id: string }> = {
    identity: { namespace: "discord", name: "cursor_get_message", authorityClass: "cursor", version: "0.1.0" },
    description: {
      summary: "Reads one Discord message.",
      whenToUse: "Use when exact message metadata or attachments are needed.",
    },
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string", description: "Discord channel ID." },
        message_id: { type: "string", description: "Discord message ID." },
      },
      required: ["channel_id", "message_id"],
    },
    sideEffects: noSideEffects(true),
    authority: { level: "read", scopes: ["discord.messages"], requiresUserConfirmation: false },
    async execute(input, context) {
      const cursor = getDiscordCursor(cursors, context.cursorId);
      if (!(cursor instanceof DiscordCursor)) return cursor;
      const message = await cursor.discord.getMessage(input.channel_id, input.message_id);
      return { ok: true, summary: `Read Discord message ${message.id}.`, data: { message } };
    },
  };

  const referenceTool: ToolDefinition<{ channel_id: string; message_id: string }> = {
    identity: { namespace: "discord", name: "cursor_get_message_reference", authorityClass: "cursor", version: "0.1.0" },
    description: {
      summary: "Reads a Discord message and its referenced message.",
      whenToUse: "Use when a reply needs its parent context.",
    },
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string", description: "Discord channel ID." },
        message_id: { type: "string", description: "Discord message ID." },
      },
      required: ["channel_id", "message_id"],
    },
    sideEffects: noSideEffects(true),
    authority: { level: "read", scopes: ["discord.messages"], requiresUserConfirmation: false },
    async execute(input, context) {
      const cursor = getDiscordCursor(cursors, context.cursorId);
      if (!(cursor instanceof DiscordCursor)) return cursor;
      const result = await cursor.discord.getMessageReference(input.channel_id, input.message_id);
      return { ok: true, summary: `Read Discord message reference for ${input.message_id}.`, data: result };
    },
  };

  const replyMentionTool: ToolDefinition<{
    channel_id: string;
    message_id: string;
    content: string;
  }> = {
    identity: { namespace: "discord", name: "cursor_reply_mention", authorityClass: "cursor", version: "0.1.0" },
    description: {
      summary: "Replies to a Discord message only when that source message explicitly mentions the bot.",
      whenToUse: "Use for passive @reply behavior in the current Discord Cursor.",
      whenNotToUse: "Do not use for proactive sends, non-mention replies, announcements, or moderation.",
    },
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string", description: "Discord channel ID." },
        message_id: { type: "string", description: "Mentioning message ID to reply to." },
        content: { type: "string", description: "Reply content." },
      },
      required: ["channel_id", "message_id", "content"],
    },
    sideEffects: {
      externalVisible: true,
      writesFileSystem: false,
      networkAccess: true,
      startsProcess: false,
      changesConfig: false,
      consumesBudget: false,
      affectsUserState: true,
    },
    authority: { level: "external_write", scopes: ["discord.mention_reply"], requiresUserConfirmation: false },
    async execute(input, context) {
      const cursor = getDiscordCursor(cursors, context.cursorId);
      if (!(cursor instanceof DiscordCursor)) return cursor;
      const status = await cursor.discord.getStatus();
      const sourceMessage = await cursor.discord.getMessage(input.channel_id, input.message_id);
      if (!cursor.canReplyToMention(sourceMessage, status.botUserId)) {
        return {
          ok: false,
          summary: "Discord Cursor can only reply when the source message explicitly mentions the bot.",
          error: {
            code: "mention_required",
            message: "Discord Cursor can only reply when the source message explicitly mentions the bot.",
            retryable: false,
          },
        };
      }
      const message = await cursor.discord.sendMessage({
        channelId: input.channel_id,
        content: visibleDiscordContent(input.content),
        replyToMessageId: input.message_id,
      });
      return {
        ok: true,
        summary: `Replied to mentioning Discord message ${input.message_id}.`,
        data: { message, sourceMessage },
        sideEffects: [
          {
            type: "discord_mention_reply_sent",
            summary: `Replied to @mention in Discord channel ${input.channel_id}.`,
            visible: true,
            timestamp: Date.now(),
          },
        ],
      };
    },
  };

  const replyDirectTool: ToolDefinition<{
    channel_id: string;
    message_id: string;
    content: string;
  }> = {
    identity: { namespace: "discord", name: "cursor_reply_direct", authorityClass: "cursor", version: "0.1.0" },
    description: {
      summary: "Replies to a direct Discord message received by the bot.",
      whenToUse: "Use for passive DM replies in the current Discord Cursor.",
      whenNotToUse: "Do not use for guild messages, proactive sends, announcements, or moderation.",
    },
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string", description: "Discord DM channel ID." },
        message_id: { type: "string", description: "Source DM message ID." },
        content: { type: "string", description: "Reply content." },
      },
      required: ["channel_id", "message_id", "content"],
    },
    sideEffects: {
      externalVisible: true,
      writesFileSystem: false,
      networkAccess: true,
      startsProcess: false,
      changesConfig: false,
      consumesBudget: false,
      affectsUserState: true,
    },
    authority: { level: "external_write", scopes: ["discord.dm_reply"], requiresUserConfirmation: false },
    async execute(input, context) {
      const cursor = getDiscordCursor(cursors, context.cursorId);
      if (!(cursor instanceof DiscordCursor)) return cursor;
      const sourceMessage = await cursor.discord.getMessage(input.channel_id, input.message_id);
      if (sourceMessage.guildId) {
        return {
          ok: false,
          summary: "Discord Cursor direct replies are allowed only for DM source messages.",
          error: {
            code: "dm_required",
            message: "Discord Cursor direct replies are allowed only for DM source messages.",
            retryable: false,
          },
        };
      }
      const message = await cursor.discord.sendMessage({
        channelId: input.channel_id,
        content: visibleDiscordContent(input.content),
        replyToMessageId: input.message_id,
      });
      return {
        ok: true,
        summary: `Replied to Discord DM ${input.message_id}.`,
        data: { message, sourceMessage },
        sideEffects: [
          {
            type: "discord_dm_reply_sent",
            summary: `Replied to DM in Discord channel ${input.channel_id}.`,
            visible: true,
            timestamp: Date.now(),
          },
        ],
      };
    },
  };

  const sendTool: ToolDefinition<{
    channel_id: string;
    content: string;
    mention_user_ids?: string[];
    reply_to_message_id?: string;
  }> = {
    identity: { namespace: "discord", name: "stelle_send_message", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Sends a Discord message through the current Discord Cursor runtime.",
      whenToUse: "Use only when Core Mind or an approved higher authority decides to send externally visible text.",
      whenNotToUse: "Do not expose as a Cursor Tool or use for passive local processing.",
    },
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string", description: "Discord channel ID." },
        content: { type: "string", description: "Message content." },
        mention_user_ids: { type: "array", items: { type: "string" }, description: "Optional user IDs to mention." },
        reply_to_message_id: { type: "string", description: "Optional message ID to reply to." },
      },
      required: ["channel_id", "content"],
    },
    sideEffects: {
      externalVisible: true,
      writesFileSystem: false,
      networkAccess: true,
      startsProcess: false,
      changesConfig: false,
      consumesBudget: false,
      affectsUserState: true,
    },
    authority: { level: "external_write", scopes: ["discord.messages"], requiresUserConfirmation: false },
    async execute(input, context) {
      const cursor = getDiscordCursor(cursors, context.cursorId);
      if (!(cursor instanceof DiscordCursor)) return cursor;
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
        sideEffects: [
          {
            type: "discord_message_sent",
            summary: `Sent a message to Discord channel ${input.channel_id}.`,
            visible: true,
            timestamp: Date.now(),
          },
        ],
      };
    },
  };

  return [statusTool, listChannelsTool, historyTool, getMessageTool, referenceTool, replyMentionTool, replyDirectTool, sendTool];
}

function noSideEffects(networkAccess: boolean) {
  return {
    externalVisible: false,
    writesFileSystem: false,
    networkAccess,
    startsProcess: false,
    changesConfig: false,
    consumesBudget: false,
    affectsUserState: false,
  };
}
