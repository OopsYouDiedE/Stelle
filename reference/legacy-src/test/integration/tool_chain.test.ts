import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscordRouter } from "../../src/cursor/discord/router.js";
import { DiscordToolExecutor } from "../../src/cursor/discord/executor.js";
import { createDefaultToolRegistry } from "../../src/tool.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";

describe("Tool Chain Integration: Router -> Executor -> ToolRegistry", () => {
  let context: any;
  let router: DiscordRouter;
  let executor: DiscordToolExecutor;
  let registry: any;
  let generateJson: any;

  beforeEach(() => {
    generateJson = vi.fn();
    registry = createDefaultToolRegistry({
      // 传入 Mock 的记忆存储，确保工具能执行但不会真的操作文件
      memory: {
        searchHistory: vi.fn().mockResolvedValue([]),
        readRecent: vi.fn().mockResolvedValue([]),
      } as any,
    });

    context = {
      now: () => Date.now(),
      config: {
        models: { apiKey: "test-key" },
        discord: { cooldownSeconds: 0 },
      },
      llm: { generateJson },
      tools: registry,
      eventBus: new StelleEventBus(),
    };

    router = new DiscordRouter(context, "Test Persona");
    executor = new DiscordToolExecutor(context, "discord");
  });

  it("should successfully execute memory tools even if LLM omits 'scope'", async () => {
    // 1. 模拟 LLM 输出（不带 scope 参数）
    generateJson.mockImplementationOnce(async (_p, _s, normalize) =>
      normalize({
        mode: "reply",
        intent: "memory_query",
        reason: "user query",
        needs_thinking: true,
        tool_plan: {
          calls: [{ tool: "memory.search", parameters: { text: "trash can" } }],
          parallel: false,
        },
      }),
    );

    const session: any = { channelId: "c1", history: [], mode: "active" };
    const batch: any[] = [
      {
        author: { id: "u1", username: "Explorer" },
        channelId: "c1",
        content: "你记得垃圾桶吗？",
      },
    ];

    // 2. Router 设计策略
    const policy = await router.designPolicy(session, batch, true);

    // 3. Executor 执行计划（带上下文）
    const results = await executor.execute(policy, "external", {
      channelId: "c1",
      authorId: "u1",
    });

    // 4. 验证：工具应该成功执行 (ok=true)，说明 Executor 补全了 Zod 要求的 scope
    expect(results[0].name).toBe("memory.search");
    expect(results[0].ok).toBe(true);
    expect(results[0].summary).toContain("Found 0 result");
  });

  it("should filter out non-policy tools at the Router level", async () => {
    // 模拟 LLM 试图执行未在策略白名单中的工具 (例如系统命令)
    generateJson.mockImplementationOnce(async (_p, _s, normalize) =>
      normalize({
        mode: "reply",
        intent: "malicious",
        reason: "jailbreak attempt",
        needs_thinking: false,
        tool_plan: {
          calls: [{ tool: "system.run_command", parameters: { command: "rm -rf /" } }],
          parallel: false,
        },
      }),
    );

    const session: any = { channelId: "c1", history: [], mode: "active" };
    const batch: any[] = [{ author: { id: "u1" }, content: "Delete everything" }];

    const policy = await router.designPolicy(session, batch, true);

    // 验证：在 Router 层，system.run_command 应该被过滤掉
    expect(policy.toolPlan?.calls.length).toBe(0);
  });

  it("should block tools with insufficient authority at the Registry level", async () => {
    // 即使 Router 允许（手动构造 policy），Registry 也应该根据 trustLevel 拦截
    const policy: any = {
      mode: "reply",
      intent: "memory_write",
      toolPlan: {
        calls: [
          { tool: "memory.write_long_term", parameters: { key: "secret", value: "hacked", layer: "core_identity" } },
        ],
        parallel: false,
      },
    };

    // 执行者以 "external" (外部普通用户) 身份执行，不具备 safe_write 权限
    const results = await executor.execute(policy, "external", { channelId: "c1", authorId: "u1" });

    expect(results[0].ok).toBe(false);
    // 检查错误代码，而不是 summary 文案
    expect((results[0] as any).error.code).toBe("authority_denied");
  });
});
