import assert from "node:assert/strict";
import test from "node:test";

import {
  CoreMind,
  CursorRegistry,
  CursorRuntime,
  DiscordCursor,
  ToolRegistry,
  createDiscordCursorTools,
} from "../index.js";
import type {
  DiscordChannelSummary,
  DiscordMessageSummary,
  DiscordRuntime,
  DiscordRuntimeStatus,
} from "../index.js";

const TEST_CHANNEL_ID = "1494546366808985710";

class FakeDiscordRuntime implements DiscordRuntime {
  readonly sent: { channelId: string; content: string }[] = [];
  readonly messages: DiscordMessageSummary[] = [
    message("m1", TEST_CHANNEL_ID, "u1", "alice", "hello", 1000),
    message("m2", TEST_CHANNEL_ID, "u2", "bob", "reply", 2000, { channelId: TEST_CHANNEL_ID, messageId: "m1" }),
    message("m3", TEST_CHANNEL_ID, "u3", "carol", "<@bot> ping", 3000, undefined, ["bot"]),
  ];

  async getStatus(): Promise<DiscordRuntimeStatus> {
    return { connected: true, botUserId: "bot", guildCount: 1 };
  }

  async listChannels(): Promise<DiscordChannelSummary[]> {
    return [
      {
        id: TEST_CHANNEL_ID,
        guildId: "guild",
        name: "stelle-test",
        type: "GuildText",
        isTextBased: true,
        isSendable: true,
      },
    ];
  }

  async getChannelHistory(options: { limit?: number }): Promise<DiscordMessageSummary[]> {
    return this.messages.slice(0, options.limit ?? this.messages.length);
  }

  async getMessage(_channelId: string, messageId: string): Promise<DiscordMessageSummary> {
    const found = this.messages.find((item) => item.id === messageId);
    if (!found) throw new Error("missing message");
    return found;
  }

  async getMessageReference(_channelId: string, messageId: string) {
    const sourceMessage = await this.getMessage(TEST_CHANNEL_ID, messageId);
    const referencedMessage = sourceMessage.reference?.messageId
      ? await this.getMessage(sourceMessage.reference.channelId ?? TEST_CHANNEL_ID, sourceMessage.reference.messageId)
      : null;
    return { sourceMessage, referencedMessage };
  }

  async sendMessage(input: { channelId: string; content: string }): Promise<DiscordMessageSummary> {
    this.sent.push(input);
    return message("sent-1", input.channelId, "bot", "stelle", input.content, 3000);
  }
}

test("DiscordCursor runs independently and records passive Discord messages", async () => {
  const cursors = new CursorRegistry();
  cursors.register(new DiscordCursor(new FakeDiscordRuntime()));
  const runtime = new CursorRuntime(cursors, new ToolRegistry());
  await runtime.startCursor("discord");

  const reports = await runtime.sendInput("discord", {
    type: "text",
    content: "来自测试频道",
    metadata: {
      discordMessage: true,
      channelId: TEST_CHANNEL_ID,
      messageId: "local-1",
      authorId: "u1",
      authorName: "alice",
    },
  });
  assert.equal(reports[0]?.type, "discord_message_queued");

  const tickReports = await runtime.tick("discord");
  assert.equal(tickReports[0]?.type, "discord_message_observed");

  const observation = await runtime.observe("discord");
  assert.ok(observation.stream.some((item) => item.content === "来自测试频道"));
});

test("Discord cursor tools can read status, channels, history, messages, and references", async () => {
  const cursors = new CursorRegistry();
  cursors.register(new DiscordCursor(new FakeDiscordRuntime()));
  const tools = new ToolRegistry();
  for (const tool of createDiscordCursorTools(cursors)) tools.register(tool);
  const runtime = new CursorRuntime(cursors, tools);
  await runtime.startCursor("discord");

  const status = await runtime.useCursorTool("discord", "discord.cursor_status", {});
  assert.equal(status.ok, true);
  assert.equal((status.data?.status as DiscordRuntimeStatus).connected, true);

  const channels = await runtime.useCursorTool("discord", "discord.cursor_list_channels", {});
  assert.equal(channels.ok, true);
  assert.equal((channels.data?.channels as DiscordChannelSummary[])[0]?.id, TEST_CHANNEL_ID);

  const history = await runtime.useCursorTool("discord", "discord.cursor_get_channel_history", {
    channel_id: TEST_CHANNEL_ID,
    limit: 2,
  });
  assert.equal(history.ok, true);
  assert.equal((history.data?.messages as DiscordMessageSummary[]).length, 2);

  const single = await runtime.useCursorTool("discord", "discord.cursor_get_message", {
    channel_id: TEST_CHANNEL_ID,
    message_id: "m1",
  });
  assert.equal((single.data?.message as DiscordMessageSummary).content, "hello");

  const reference = await runtime.useCursorTool("discord", "discord.cursor_get_message_reference", {
    channel_id: TEST_CHANNEL_ID,
    message_id: "m2",
  });
  assert.equal((reference.data?.referencedMessage as DiscordMessageSummary).id, "m1");
});

test("Discord send is not exposed to standalone CursorRuntime but CoreMind can use Stelle tool", async () => {
  const fake = new FakeDiscordRuntime();
  const cursors = new CursorRegistry();
  cursors.register(new DiscordCursor(fake));
  const tools = new ToolRegistry();
  for (const tool of createDiscordCursorTools(cursors)) tools.register(tool);

  const runtime = new CursorRuntime(cursors, tools);
  await runtime.startCursor("discord");
  const denied = await runtime.useCursorTool("discord", "discord.stelle_send_message", {
    channel_id: TEST_CHANNEL_ID,
    content: "should not send",
  });
  assert.equal(denied.ok, false);
  assert.equal(fake.sent.length, 0);

  const core = await CoreMind.create({ cursors, tools, defaultCursorId: "discord" });
  const sent = await core.useTool("discord.stelle_send_message", {
    channel_id: TEST_CHANNEL_ID,
    content: "core approved",
  });
  assert.equal(sent.ok, true);
  assert.equal(fake.sent.length, 1);
  assert.equal(fake.sent[0]?.channelId, TEST_CHANNEL_ID);
});

test("Discord Cursor can reply only to messages that mention the bot", async () => {
  const fake = new FakeDiscordRuntime();
  const cursors = new CursorRegistry();
  cursors.register(new DiscordCursor(fake));
  const tools = new ToolRegistry();
  for (const tool of createDiscordCursorTools(cursors)) tools.register(tool);
  const runtime = new CursorRuntime(cursors, tools);
  await runtime.startCursor("discord");

  const denied = await runtime.useCursorTool("discord", "discord.cursor_reply_mention", {
    channel_id: TEST_CHANNEL_ID,
    message_id: "m1",
    content: "not allowed",
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.error?.code, "mention_required");
  assert.equal(fake.sent.length, 0);

  const allowed = await runtime.useCursorTool("discord", "discord.cursor_reply_mention", {
    channel_id: TEST_CHANNEL_ID,
    message_id: "m3",
    content: "allowed reply",
  });
  assert.equal(allowed.ok, true);
  assert.equal(fake.sent.length, 1);
  assert.equal(fake.sent[0]?.content, "allowed reply");
  assert.equal(allowed.sideEffects?.[0]?.visible, true);
});

test("DiscordCursor exposes channel-local context text for local Front Actor replies", async () => {
  const cursor = new DiscordCursor(new FakeDiscordRuntime());
  await cursor.receiveMessage(message("ctx-1", TEST_CHANNEL_ID, "u1", "alice", "第一条上下文", 1000));
  await cursor.receiveMessage(message("ctx-2", TEST_CHANNEL_ID, "u2", "bob", "第二条上下文", 2000));
  await cursor.tick();

  const context = cursor.getChannelContextText(TEST_CHANNEL_ID);

  assert.match(context, /第一条上下文/);
  assert.match(context, /第二条上下文/);
  assert.match(context, /Messages seen: 2/);
});

function message(
  id: string,
  channelId: string,
  authorId: string,
  username: string,
  content: string,
  createdTimestamp: number,
  reference?: { channelId: string; messageId: string },
  mentionedUserIds?: string[]
): DiscordMessageSummary {
  return {
    id,
    channelId,
    guildId: "guild",
    author: { id: authorId, username },
    content,
    createdTimestamp,
    mentionedUserIds,
    reference: reference ? { channelId: reference.channelId, messageId: reference.messageId } : null,
    attachments: [],
    embeds: [],
  };
}
