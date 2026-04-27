import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscordCursor } from "../../src/cursor/discord_cursor.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";

describe("DiscordCursor Tool Routing Integration", () => {
  let context: any;
  let cursor: DiscordCursor;
  let generateJson: ReturnType<typeof vi.fn>;
  let eventBus: StelleEventBus;

  beforeEach(() => {
    generateJson = vi.fn();
    eventBus = new StelleEventBus();
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
      memory: { writeRecent: async () => {}, readLongTerm: async () => null },
      tools: { 
        execute: vi.fn().mockResolvedValue({ ok: true, summary: "Tool Result Data" }) 
      },
      eventBus
    };
    cursor = new DiscordCursor(context);
  });

  it("should route to memory_query and structured ToolPlan when asked about history", async () => {
    generateJson.mockImplementationOnce(async (_prompt, _schema, normalize) => normalize({
      mode: "reply",
      intent: "memory_query",
      reason: "user asks about remembered history",
      needs_thinking: true,
      tool_plan: {
        calls: [
          { tool: "memory.search", parameters: { text: "trash can" } },
          { tool: "memory.read_recent", parameters: { limit: 5 } }
        ],
        parallel: true
      }
    }));

    const session = (cursor as any).sessionFor({ channelId: "c1", guildId: "g1" });
    session.mode = "active";

    const batch = [{
      id: "m1", content: "Stelle，你还记得我们上次聊的那个垃圾桶吗？",
      cleanContent: "Stelle，你还记得我们上次聊的那个垃圾桶吗？",
      author: { username: "Explorer", trustLevel: "owner" },
      mentionedUserIds: []
    }];

    const policy = await (cursor as any).designPolicy(session, batch, true);

    expect(policy.intent).toBe("memory_query");
    expect(policy.toolPlan?.calls[0].tool).toBe("memory.search");
    expect(policy.toolPlan?.calls[0].parameters.text).toBe("trash can");
  });

  it("should route to system_status when asked about live stream state", async () => {
    generateJson.mockImplementationOnce(async (_prompt, _schema, normalize) => normalize({
      mode: "reply",
      intent: "system_status",
      reason: "user asks for runtime status",
      needsThinking: false,
      tool_plan: {
        calls: [{ tool: "live.status", parameters: {} }],
        parallel: true
      }
    }));

    const session = (cursor as any).sessionFor({ channelId: "c1", guildId: "g1" });
    const batch = [{
      id: "m2", content: "现在直播间在线吗？",
      cleanContent: "现在直播间在线吗？",
      author: { username: "Explorer", trustLevel: "external" },
      mentionedUserIds: []
    }];

    const policy = await (cursor as any).designPolicy(session, batch, true);

    expect(policy.intent).toBe("system_status");
    expect(policy.toolPlan?.calls[0].tool).toBe("live.status");
  });
});
