import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscordCursor } from "../../src/cursor/discord_cursor.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";

describe("Event-Driven Context Flow Integration", () => {
  let context: any;
  let cursor: DiscordCursor;
  let eventBus: StelleEventBus;

  beforeEach(async () => {
    eventBus = new StelleEventBus();
    context = {
      now: () => Date.now(),
      config: { 
        models: { apiKey: "test-key" },
        discord: { cooldownSeconds: 0, ambientEnabled: true },
        rawYaml: { channels: { "c1": { activated: true } } }
      },
      llm: { 
        generateJson: vi.fn().mockResolvedValue({ mode: "reply", intent: "local_chat" }),
        generateText: vi.fn().mockResolvedValue("Reply")
      },
      tools: {
        execute: vi.fn().mockResolvedValue({ ok: true, summary: "OK", data: { status: { botUserId: "bot-123" } } })
      },
      memory: {
        writeRecent: vi.fn().mockResolvedValue(undefined),
        readLongTerm: vi.fn().mockResolvedValue(null) // 补齐 Mock
      },
      eventBus
    };
    cursor = new DiscordCursor(context as any);
    await cursor.initialize();
  });

  it("should preserve guildId and correctly identify it is NOT a DM", async () => {
    // 模拟从 Application 发出的全量事件
    const message: any = {
      id: "m1",
      channelId: "c1",
      guildId: "g1", // 关键：有 guildId
      author: { id: "u1", username: "User", trustLevel: "external" },
      content: "Hello Stelle",
      cleanContent: "Hello Stelle",
      mentionedUserIds: ["bot-123"]
    };

    const spy = vi.spyOn(cursor as any, "executeBatch");

    // 发布事件
    eventBus.publish({
      type: "discord.message.received",
      source: "discord",
      id: "evt-1",
      timestamp: Date.now(),
      payload: { message }
    });

    // 等待 Gateway 缓冲 (由于是 mention，延迟很短)
    await new Promise(r => setTimeout(r, 500));

    // 验证：应该识别为 DirectMention (因为被 mention 了)，但 session 应该带有 guildId
    expect(spy).toHaveBeenCalled();
    const session = spy.mock.calls[0][0];
    expect(session.guildId).toBe("g1");
  });

  it("should preserve owner trustLevel across the event bus", async () => {
    const message: any = {
      id: "m2",
      channelId: "c1",
      guildId: "g1",
      author: { id: "owner-1", username: "Admin", trustLevel: "owner" }, // 关键：owner 权限
      content: "Important command",
      mentionedUserIds: ["bot-123"]
    };

    const spy = vi.spyOn(cursor as any, "executeBatch");

    eventBus.publish({
      type: "discord.message.received",
      source: "discord",
      id: "evt-2",
      timestamp: Date.now(),
      payload: { message }
    });

    await new Promise(r => setTimeout(r, 500));

    expect(spy).toHaveBeenCalled();
    const batch = spy.mock.calls[0][1];
    expect(batch[0].author.trustLevel).toBe("owner"); // 权限链必须保持
  });

  it("should properly ignore bot messages received via event bus", async () => {
    const message: any = {
      id: "m3",
      channelId: "c1",
      author: { id: "bot-2", username: "OtherBot", bot: true }, // 关键：是 Bot
      content: "Ignore me"
    };

    const receiveSpy = vi.spyOn(cursor, "receiveMessage");

    eventBus.publish({
      type: "discord.message.received",
      source: "discord",
      id: "evt-3",
      timestamp: Date.now(),
      payload: { message }
    });

    await new Promise(r => setTimeout(r, 100));
    
    // receiveMessage 应该被调用（事件到达了），但 Gateway 应该返回 observed: false
    const result = await (receiveSpy.mock.results[0].value as Promise<any>);
    expect(result.observed).toBe(false);
    expect(result.reason).toContain("ignored");
  });
});
