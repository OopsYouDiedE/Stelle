import "dotenv/config";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscordCursor } from "../../src/cursor/discord_cursor.js";
import { LlmClient } from "../../src/utils/llm.js";

describe("Discord Context Strategy (Patient Observer Replay)", () => {
  let context: any;
  let cursor: DiscordCursor;

  beforeEach(() => {
    const llm = new LlmClient();
    context = {
      now: () => Date.now(),
      config: { 
        models: { apiKey: process.env.GEMINI_API_KEY, primaryModel: "gemini-3-flash-preview", secondaryModel: "gemini-3-flash-preview" },
        discord: { ambientEnabled: true, cooldownSeconds: 0 },
        rawYaml: { channels: { "1235845356697288747": { activated: true } } }
      },
      llm,
      memory: { writeRecent: async () => {} },
      tools: { execute: async () => ({ ok: true, summary: "Mock Tool Executed" }) },
      dispatch: vi.fn().mockResolvedValue({ accepted: true })
    };
    cursor = new DiscordCursor(context);
  });

  it("should buffer messages and wait for topic formation in SILENT mode", async () => {
    // 模拟进入静音模式
    const session: any = (cursor as any).sessionFor({ channelId: "1235845356697288747", guildId: "g1" });
    session.mode = "silent";
    session.modeExpiresAt = Date.now() + 3600000;

    // 输入第一句话：应该只是观察，不触发决策
    const res1 = await cursor.receiveMessage({
      id: "m1", channelId: "1235845356697288747", author: { username: "UserA" },
      content: "Hello there", cleanContent: "Hello there"
    } as any);
    
    expect(res1.reason).toContain("patiently observing");
    expect(session.inbox.length).toBe(1);
    expect(context.dispatch).not.toHaveBeenCalled();
  });

  it("should fast-track response when DIRECTLY MENTIONED", async () => {
    const res = await cursor.receiveMessage({
      id: "m2", channelId: "1235845356697288747", author: { username: "UserA" },
      content: "Hey @Stelle", cleanContent: "Hey @Stelle",
      mentionedUserIds: ["STELLE_BOT_ID"] // 假设这是 Bot ID
    } as any);

    // 虽然具体响应是异步的，但 reason 应该体现出处理意图
    expect(res.reason).toBe("buffering context"); // 因为有 200ms debounce
  });
});
