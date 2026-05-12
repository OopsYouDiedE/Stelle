import { describe, expect, it } from "vitest";
import { StelleEventBus } from "../../src/core/event/event_bus.js";
import { DiscordWindow } from "../../src/windows/discord/discord_window.js";
import type { DiscordMessageSummary } from "../../src/windows/discord/runtime.js";

describe("Discord reply routing", () => {
  it("ignores ordinary channel chatter by default", async () => {
    const events = new StelleEventBus();
    const window = new DiscordWindow({
      config: { rawYaml: { cursors: { discord: { ambientEnabled: false } } } },
      discord: fakeDiscord(),
      events,
      logger: console,
    });

    await window.receiveMessage(message({ content: "hello?", isMentioned: false, isDirectMessage: false }));

    expect(events.getHistory().map((event) => event.type)).not.toContain("perceptual.event");
  });

  it("uses reply only for @ mentions and send for other routed Discord responses", async () => {
    const discord = fakeDiscord();
    const events = new StelleEventBus();
    const window = new DiscordWindow({
      config: { rawYaml: {} },
      discord,
      events,
      logger: console,
    });

    await window.receiveIntent({
      id: "intent-send",
      type: "respond",
      sourcePackageId: "test",
      priority: 1,
      createdAt: Date.now(),
      reason: "dm response",
      payload: {
        sourceWindow: "window.discord",
        channelId: "channel-1",
        replyToMessageId: "message-1",
        discordReplyMode: "send",
        text: "plain send",
      },
    });

    await window.receiveIntent({
      id: "intent-reply",
      type: "respond",
      sourcePackageId: "test",
      priority: 1,
      createdAt: Date.now(),
      reason: "mention response",
      payload: {
        sourceWindow: "window.discord",
        channelId: "channel-1",
        replyToMessageId: "message-2",
        discordReplyMode: "reply",
        text: "threaded reply",
      },
    });

    expect(discord.sent[0]).toMatchObject({ channelId: "channel-1", content: "plain send" });
    expect(discord.sent[0].replyToMessageId).toBeUndefined();
    expect(discord.sent[1]).toMatchObject({
      channelId: "channel-1",
      content: "threaded reply",
      replyToMessageId: "message-2",
    });
  });

  it("stays in a channel briefly after summon and leaves when dismissed", async () => {
    const events = new StelleEventBus();
    const window = new DiscordWindow({
      config: { rawYaml: { cursors: { discord: { ambientEnabled: true, cooldownSeconds: 60 } } } },
      discord: fakeDiscord(),
      events,
      logger: console,
    });

    await window.receiveMessage(message({ id: "ambient-1", content: "普通聊天？", isMentioned: false }));
    expect(events.getHistory().filter((event) => event.type === "perceptual.event")).toHaveLength(0);

    await window.receiveMessage(message({ id: "summon-1", content: "@Stelle", cleanContent: "@Stelle", isMentioned: true }));
    await window.receiveMessage(message({ id: "ambient-2", content: "这句在驻留期内", isMentioned: false }));

    expect(events.getHistory().filter((event) => event.type === "perceptual.event")).toHaveLength(2);

    await window.receiveMessage(message({ id: "dismiss-1", content: "没事了，不用回复", isMentioned: false }));
    await window.receiveMessage(message({ id: "ambient-3", content: "之后继续普通聊天？", isMentioned: false }));

    expect(events.getHistory().filter((event) => event.type === "perceptual.event")).toHaveLength(2);
  });
});

function fakeDiscord() {
  return {
    sent: [] as any[],
    onMessage() {
      return () => undefined;
    },
    async login() {
      return undefined;
    },
    async setBotPresence() {
      return undefined;
    },
    async destroy() {
      return undefined;
    },
    getStatusSync() {
      return { connected: true };
    },
    async sendMessage(input: any) {
      this.sent.push(input);
      return {
        id: `sent-${this.sent.length}`,
        channelId: input.channelId,
        content: input.content,
        cleanContent: input.content,
        createdTimestamp: Date.now(),
        author: { id: "bot", username: "Stelle", bot: true },
      };
    },
  } as any;
}

function message(overrides: Partial<DiscordMessageSummary>): DiscordMessageSummary {
  return {
    id: "message-1",
    channelId: "channel-1",
    guildId: "guild-1",
    author: { id: "user-1", username: "User", bot: false },
    content: "hello?",
    cleanContent: "hello?",
    createdTimestamp: Date.now(),
    isMentioned: false,
    isDirectMessage: false,
    ...overrides,
  };
}
