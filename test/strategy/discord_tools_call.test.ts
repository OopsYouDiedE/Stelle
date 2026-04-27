import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscordCursor } from "../../src/cursor/discord_cursor.js";

describe("DiscordCursor Tool Routing Integration", () => {
  let context: any;
  let cursor: DiscordCursor;
  let generateJson: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    generateJson = vi.fn();
    context = {
      now: () => Date.now(),
      config: { 
        models: { 
          apiKey: "test-key",
          dashscopeApiKey: "test-key",
          geminiApiKey: "",
          primaryModel: "qwen-max",
          secondaryModel: "qwen-plus"
        },
        discord: { ambientEnabled: true, cooldownSeconds: 0 },
        rawYaml: { channels: { "c1": { activated: true } } }
      },
      llm: { generateJson, generateText: vi.fn() },
      memory: { writeRecent: async () => {}, appendSessionHistory: () => {} },
      tools: { 
        execute: vi.fn().mockResolvedValue({ ok: true, summary: "Tool Result Data" }) 
      },
      dispatch: vi.fn().mockResolvedValue({ accepted: true })
    };
    cursor = new DiscordCursor(context);
  });

  it("should route to memory_query and suggest search tools when asked about history", async () => {
    generateJson.mockImplementationOnce(async (_prompt, _schema, normalize) => normalize({
      mode: "reply",
      intent: "memory_query",
      reason: "user asks about remembered history",
      needs_thinking: true,
      suggested_tools: ["memory.search", "memory.read_recent"]
    }));

    // 强制访问私有方法进行测试
    const session = (cursor as any).sessionFor({ channelId: "c1", guildId: "g1" });
    session.mode = "active";

    const batch = [{
      id: "m1", content: "Stelle，你还记得我们上次聊的那个垃圾桶吗？",
      cleanContent: "Stelle，你还记得我们上次聊的那个垃圾桶吗？",
      author: { username: "Explorer" }
    }];

    // 调用内部的路由决策
    const policy = await (cursor as any).designPolicy(session, batch, true);

    expect(policy.intent).toBe("memory_query");
    expect(policy.suggestedTools).toContain("memory.search");
  });

  it("should route to system_status when asked about live stream state", async () => {
    generateJson.mockImplementationOnce(async (_prompt, _schema, normalize) => normalize({
      mode: "reply",
      intent: "system_status",
      reason: "user asks for runtime status",
      needsThinking: false,
      suggestedTools: ["live.status", "discord.status"]
    }));

    const session = (cursor as any).sessionFor({ channelId: "c1", guildId: "g1" });
    const batch = [{
      id: "m2", content: "现在直播间在线吗？",
      cleanContent: "现在直播间在线吗？",
      author: { username: "Explorer" }
    }];

    const policy = await (cursor as any).designPolicy(session, batch, true);

    expect(policy.intent).toBe("system_status");
    expect(policy.suggestedTools.some((t: string) => t.includes("live") || t.includes("discord"))).toBe(true);
  });
});
