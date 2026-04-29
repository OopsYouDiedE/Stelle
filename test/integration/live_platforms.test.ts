import { describe, expect, it } from "vitest";
import { normalizeBilibiliCommand } from "../../src/live/platforms/bilibili.js";
import { normalizeTikTokPayload } from "../../src/live/platforms/tiktok.js";
import { normalizeTwitchIrcLine } from "../../src/live/platforms/twitch.js";
import { normalizeYoutubeMessage } from "../../src/live/platforms/youtube.js";

describe("live platform normalization", () => {
  it("normalizes Twitch IRC PRIVMSG tags", () => {
    const event = normalizeTwitchIrcLine(
      "@badge-info=;badges=;display-name=Alice;id=msg-1;room-id=room-1;tmi-sent-ts=1700000000000;user-id=user-1 :alice!alice@alice.tmi.twitch.tv PRIVMSG #stelle :hello chat",
      "stelle",
    );

    expect(event).toMatchObject({
      id: "msg-1",
      source: "twitch",
      kind: "danmaku",
      roomId: "room-1",
      user: { id: "user-1", name: "Alice" },
      text: "hello chat",
    });
  });

  it("normalizes YouTube super chat messages", () => {
    const event = normalizeYoutubeMessage({
      id: "yt-1",
      snippet: {
        type: "superChatEvent",
        publishedAt: "2026-04-29T08:00:00Z",
        displayMessage: "加油",
        superChatDetails: { amountMicros: "5000000", currency: "JPY" },
      },
      authorDetails: { channelId: "chan-1", displayName: "Yuki" },
    }, "chat-1");

    expect(event).toMatchObject({
      id: "yt-1",
      source: "youtube",
      kind: "super_chat",
      priority: "high",
      roomId: "chat-1",
      user: { id: "chan-1", name: "Yuki" },
      text: "加油",
      trustedPayment: { rawType: "super_chat", amount: 5, currency: "JPY" },
    });
  });

  it("normalizes Bilibili gifts", () => {
    const event = normalizeBilibiliCommand({
      cmd: "SEND_GIFT",
      data: {
        uid: 42,
        uname: "小星",
        giftName: "辣条",
        price: 1000,
      },
    }, "1000");

    expect(event).toMatchObject({
      source: "bilibili",
      kind: "gift",
      priority: "medium",
      roomId: "1000",
      user: { id: "42", name: "小星" },
      text: "辣条",
      trustedPayment: { rawType: "gift", amount: 1000, currency: "CNY", giftName: "辣条" },
    });
  });

  it("normalizes TikTok websocket payload arrays", () => {
    const events = normalizeTikTokPayload({
      messages: [{
        type: "follow",
        user: { userId: "u1", nickname: "Mina" },
        timestamp: 1700000000000,
      }],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: "tiktok",
      kind: "follow",
      user: { id: "u1", name: "Mina" },
    });
  });
});

