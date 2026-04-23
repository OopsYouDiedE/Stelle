import assert from "node:assert/strict";
import test from "node:test";

import { CursorRegistry, CursorRuntime, DiscordChannelSession, DiscordCursor, ToolRegistry } from "../index.js";
import type { DiscordChannelSummary, DiscordMessageSummary, DiscordRuntime, DiscordRuntimeStatus } from "../index.js";

const TEST_CHANNEL_ID = "1494546366808985710";

class FakeDiscordRuntime implements DiscordRuntime {
  async getStatus(): Promise<DiscordRuntimeStatus> {
    return { connected: true, botUserId: "bot", guildCount: 1 };
  }

  async listChannels(): Promise<DiscordChannelSummary[]> {
    return [];
  }

  async getChannelHistory(): Promise<DiscordMessageSummary[]> {
    return [];
  }

  async getMessage(): Promise<DiscordMessageSummary> {
    throw new Error("not implemented");
  }

  async getMessageReference(): Promise<{
    sourceMessage: DiscordMessageSummary;
    referencedMessage: DiscordMessageSummary | null;
  }> {
    throw new Error("not implemented");
  }

  async sendMessage(): Promise<DiscordMessageSummary> {
    throw new Error("not implemented");
  }
}

test("DiscordChannelSession keeps the old channel context fields", () => {
  const session = new DiscordChannelSession(TEST_CHANNEL_ID, { botUserId: "bot", historyMaxLen: 4 });
  session.parseMessage(message("m1", "u1", "alice", "hello", 1000));
  session.parseMessage(message("m2", "u2", "bob", "reply", 2000, { channelId: TEST_CHANNEL_ID, messageId: "m1" }));
  session.updateIntentSummary({ focus: "answer mention", intentSummary: "reply when directly addressed" });
  session.setWaitCondition({ type: "mention", summary: "waiting for @", expiresAt: 5000 });
  session.muteFor(30);

  const snapshot = session.snapshot();
  assert.equal(snapshot.channelId, TEST_CHANNEL_ID);
  assert.equal(snapshot.guildId, "guild");
  assert.equal(snapshot.activeUserCount, 2);
  assert.equal(snapshot.msgCount, 2);
  assert.equal(snapshot.msgCountSinceReview, 2);
  assert.equal(snapshot.lastAuthorId, "u2");
  assert.equal(snapshot.lastMessageId, "m2");
  assert.equal(snapshot.focus, "answer mention");
  assert.equal(snapshot.intentSummary, "reply when directly addressed");
  assert.equal(snapshot.waitConditionType, "mention");
  assert.equal(snapshot.waitExpiresAt, 5000);
  assert.ok(snapshot.shutUpUntil);
  assert.ok(snapshot.recentHistory.some((line) => line.includes("alice: hello")));
  assert.ok(snapshot.recentHistory.some((line) => line.includes("replied_to: m1")));
});

test("DiscordChannelSession trims history without losing counters", () => {
  const session = new DiscordChannelSession(TEST_CHANNEL_ID, { historyMaxLen: 2 });
  session.parseMessage(message("m1", "u1", "alice", "first", 1000));
  session.parseMessage(message("m2", "u2", "bob", "second", 2000));
  session.parseMessage(message("m3", "u3", "carol", "third", 3000));

  const snapshot = session.snapshot();
  assert.equal(snapshot.historySize, 2);
  assert.equal(snapshot.msgCount, 3);
  assert.ok(!snapshot.recentHistory.join("\n").includes("first"));
  assert.ok(snapshot.recentHistory.join("\n").includes("third"));
});

test("DiscordCursor exposes session context without a CoreMind attachment", async () => {
  const cursor = new DiscordCursor(new FakeDiscordRuntime());
  const cursors = new CursorRegistry();
  cursors.register(cursor);
  const runtime = new CursorRuntime(cursors, new ToolRegistry());
  await runtime.startCursor("discord");

  await runtime.sendInput("discord", {
    type: "text",
    content: "<@bot> old context style",
    metadata: {
      discordMessage: true,
      channelId: TEST_CHANNEL_ID,
      guildId: "guild",
      messageId: "local-mention",
      authorId: "u1",
      authorName: "alice",
      mentionedUserIds: ["bot"],
    },
  });
  await runtime.tick("discord");

  const snapshot = cursor.getChannelSnapshot(TEST_CHANNEL_ID);
  assert.equal(snapshot?.msgCount, 1);
  assert.equal(snapshot?.activeUserCount, 1);
  assert.equal(snapshot?.lastAuthorId, "u1");
  assert.ok(snapshot?.recentHistory.join("\n").includes("old context style"));

  const observation = await runtime.observe("discord");
  const sessionItem = observation.stream.find((item) => item.metadata?.discordSession);
  assert.ok(sessionItem);
  assert.equal(sessionItem?.metadata?.channelId, TEST_CHANNEL_ID);
  assert.ok(String(sessionItem?.content).includes("old context style"));
});

function message(
  id: string,
  authorId: string,
  username: string,
  content: string,
  createdTimestamp: number,
  reference?: { channelId: string; messageId: string }
): DiscordMessageSummary {
  return {
    id,
    channelId: TEST_CHANNEL_ID,
    guildId: "guild",
    author: { id: authorId, username },
    content,
    createdTimestamp,
    reference: reference ? { channelId: reference.channelId, messageId: reference.messageId } : null,
    attachments: [],
    embeds: [],
  };
}
