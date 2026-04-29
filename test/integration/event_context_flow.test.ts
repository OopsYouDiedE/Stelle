import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscordCursor } from "../../src/cursor/discord/cursor.js";
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
        execute: vi.fn().mockImplementation(async (name: string) => {
          if (name === "discord.reply_message") return { ok: true, summary: "OK", data: { message: { id: "reply-1", channelId: "c1" } } };
          return { ok: true, summary: "OK", data: { status: { botUserId: "bot-123" } } };
        })
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
      createdTimestamp: Date.now(), // 补齐必填项
      mentionedUserIds: ["bot-123"]
    };

    const spy = vi.spyOn(cursor as any, "executeBatch");

    // 发布事件
    eventBus.publish({
      type: "discord.message.received",
      source: "discord",
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
      createdTimestamp: Date.now(),
      mentionedUserIds: ["bot-123"]
    };

    const spy = vi.spyOn(cursor as any, "executeBatch");

    eventBus.publish({
      type: "discord.message.received",
      source: "discord",
      payload: { message }
    });

    await new Promise(r => setTimeout(r, 500));

    expect(spy).toHaveBeenCalled();
    const batch = spy.mock.calls[0][1];
    expect(batch[0].author.trustLevel).toBe("owner"); // 权限链必须保持
  });

  it("should NOT respond in unactivated channels if not mentioned", async () => {
    // 模拟一个未激活频道的背景消息
    const message: any = {
      id: "m4",
      channelId: "inactive-channel",
      guildId: "g1",
      author: { id: "u2", username: "Stranger", trustLevel: "external" },
      content: "Just talking to myself",
      createdTimestamp: Date.now()
    };

    const spy = vi.spyOn(cursor as any, "executeBatch");

    eventBus.publish({
      type: "discord.message.received",
      source: "discord",
      payload: { message }
    });

    await new Promise(r => setTimeout(r, 500));

    // 应该因为频道未激活且未提到 Stelle 而被忽略
    expect(spy).not.toHaveBeenCalled();
  });

  it("should reject invalid message payloads via EventBus Zod validation", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // 发送一个残缺的消息负载（缺少 id 等必填项）
    eventBus.publish({
      type: "discord.message.received",
      source: "discord",
      payload: { 
        message: { content: "I am broken" } // 缺少大量 Zod 要求的字段
      }
    } as any);

    // EventBus 应该打印错误并拦截
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[EventBus] Invalid event rejected:"),
      expect.any(Object)
    );
    consoleSpy.mockRestore();
  });
  });

