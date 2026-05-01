import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscordRouter } from "../../src/cursor/discord/router.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";

describe("DiscordRouter Strategy", () => {
  let context: any;
  let router: DiscordRouter;
  let generateJson: any;

  beforeEach(() => {
    generateJson = vi.fn();
    context = {
      now: () => Date.now(),
      config: {
        models: { apiKey: "test-key" },
      },
      llm: { generateJson },
      eventBus: new StelleEventBus(),
    };
    router = new DiscordRouter(context, "Test Persona");
  });

  it("should route to memory_query and structured ToolPlan when asked about history", async () => {
    generateJson.mockImplementationOnce(async (_p, _s, normalize) =>
      normalize({
        mode: "reply",
        intent: "memory_query",
        reason: "user asks about remembered history",
        needs_thinking: true,
        tool_plan: {
          calls: [
            { tool: "memory.search", parameters: { text: "trash can" } },
            { tool: "memory.read_recent", parameters: { limit: 5 } },
          ],
          parallel: true,
        },
      }),
    );

    const session: any = { channelId: "c1", history: [], mode: "active" };
    const batch: any[] = [
      {
        author: { username: "Explorer" },
        content: "Stelle，你还记得我们上次聊的那个垃圾桶吗？",
        cleanContent: "Stelle，你还记得我们上次聊的那个垃圾桶吗？",
      },
    ];

    const policy = await router.designPolicy(session, batch, true);

    expect(policy.intent).toBe("memory_query");
    expect(policy.toolPlan?.calls[0].tool).toBe("memory.search");
    expect(policy.toolPlan?.calls[0].parameters.text).toBe("trash can");
  });

  it("should route to system_status when asked about live stream state", async () => {
    generateJson.mockImplementationOnce(async (_p, _s, normalize) =>
      normalize({
        mode: "reply",
        intent: "system_status",
        reason: "user asks for runtime status",
        needs_thinking: false,
        tool_plan: {
          calls: [{ tool: "live.status", parameters: {} }],
          parallel: true,
        },
      }),
    );

    const session: any = { channelId: "c1", history: [], mode: "active" };
    const batch: any[] = [
      {
        author: { username: "Explorer" },
        content: "现在直播间在线吗？",
        cleanContent: "现在直播间在线吗？",
      },
    ];

    const policy = await router.designPolicy(session, batch, true);

    expect(policy.intent).toBe("system_status");
    expect(policy.toolPlan?.calls[0].tool).toBe("live.status");
  });
});
