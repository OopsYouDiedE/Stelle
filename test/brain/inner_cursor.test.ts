import { describe, it, expect, vi, beforeEach } from "vitest";
import { InnerCursor } from "../../src/cursor/inner_cursor.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";

describe("InnerCursor Full Logic Coverage", () => {
  let context: any;
  let innerCursor: InnerCursor;
  let now = 1000000;

  beforeEach(() => {
    now = 1000000;
    context = {
      now: () => now,
      config: { 
        models: { apiKey: "test-key" },
        core: { reflectionAccumulationThreshold: 10, reflectionIntervalHours: 6 }
      },
      llm: {
        generateJson: vi.fn().mockImplementation(async (_p, _s, normalize) => normalize({
          insight: "Insight",
          globalMood: "calm",
          newConviction: { topic: "T", stance: "S" },
          directives: [{ target: "discord", policy: { instruction: "Do something" }, lifespanMinutes: 10 }]
        })),
        generateText: vi.fn().mockResolvedValue("Advice")
      },
      memory: {
        readRecent: vi.fn().mockResolvedValue([]), // 补齐 Mock
        readLongTerm: vi.fn().mockResolvedValue(null),
        writeLongTerm: vi.fn().mockResolvedValue(undefined),
        readResearchLogs: vi.fn().mockResolvedValue([]),
        appendResearchLog: vi.fn().mockResolvedValue("log-123")
      },
      tools: {
        execute: vi.fn().mockResolvedValue({ ok: true, summary: "OK" })
      },
      eventBus: new StelleEventBus()
    };
    innerCursor = new InnerCursor(context as any);
  });

  // --- 死角测试 1: 初始化异常 (L88) ---
  it("should handle corrupted conviction data during initialization", async () => {
    context.memory.readLongTerm.mockResolvedValueOnce("invalid-json-{");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await innerCursor.initialize();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to load convictions"));
    warnSpy.mockRestore();
  });

  // --- 死角测试 2: 无 API Key 咨询 (L108) ---
  it("should return intuition when API key is missing during consult", async () => {
    context.config.models.apiKey = "";
    const advice = await innerCursor.consult("discord", "Hi", "...");
    expect(advice).toBe("跟随你的直觉。");
  });

  // --- 死角测试 3: 认知合成并发抑制 (L173) ---
  it("should prevent concurrent synthesis tasks", async () => {
    // 模拟一个永远挂起的 LLM 调用
    let resolveLlm: any;
    const hangingPromise = new Promise((res) => { resolveLlm = res; });
    context.llm.generateJson.mockReturnValueOnce(hangingPromise);

    // 触发第一次（进入 reflects 状态）
    innerCursor.recordDecision({ salience: "high" } as any);
    // 等待一个微任务让异步内存读取完成
    await new Promise(r => setTimeout(r, 0));
    expect(innerCursor.snapshot().status).toBe("active");

    // 触发第二次
    innerCursor.recordDecision({ salience: "high" } as any);
    
    // 验证 generateJson 只被调用了一次
    expect(context.llm.generateJson).toHaveBeenCalledTimes(1);
  });

  // --- 死角测试 4: 信念容量上限与 shift (L190) ---
  it("should limit convictions to 20 and shift old ones", async () => {
    // 预填 20 个信念
    const existing = Array.from({ length: 20 }).map((_, i) => ({ topic: `T${i}`, stance: `S${i}` }));
    context.memory.readLongTerm.mockResolvedValueOnce(JSON.stringify(existing));
    await innerCursor.initialize();

    // 模拟生成第 21 个信念 (T20)
    context.llm.generateJson.mockImplementationOnce(async (_p, _s, normalize) => normalize({
      insight: "...",
      newConviction: { topic: "T20", stance: "S20" },
      directives: []
    }));

    // 触发一次合成
    await innerCursor.recordDecision({ salience: "high" } as any);
    await new Promise(r => setTimeout(r, 50)); // 等待异步逻辑

    const snapshot = innerCursor.snapshot();
    expect(snapshot.state.convictionsCount).toBe(20);
    // 验证第一个是否被挤掉了 (T0 应该不在了)
    const convictions = (innerCursor as any).coreConvictions;
    expect(convictions[0].topic).toBe("T1"); 
    expect(convictions[19].topic).toBe("T20");
  });

  // --- 死角测试 5: 无效指令过滤 (L213) ---
  it("should ignore directives with empty instructions", async () => {
    context.llm.generateJson.mockImplementationOnce(async (_p, _s, normalize) => normalize({
      insight: "...",
      directives: [{ target: "discord", policy: { instruction: "" }, lifespanMinutes: 10 }]
    }));

    await innerCursor.recordDecision({ salience: "high" } as any);
    await new Promise(r => setTimeout(r, 50));

    expect(innerCursor.snapshot().state.activeDirectivesCount).toBe(0);
  });

  // --- 边界测试: 空闲反思触发 ---
  it("should handle idle reflection only when there is something to reflect", async () => {
    // 情况 A: 有积压，时间够 -> 触发
    innerCursor.receiveDispatch({
      type: "cursor.reflection", source: "discord",
      payload: { intent: "chat", summary: "x", impactScore: 1, salience: "low" }
    });
    
    now += 31 * 60 * 1000;
    await innerCursor.tick();
    expect(context.llm.generateJson).toHaveBeenCalled();

    vi.clearAllMocks();

    // 情况 B: 没积压，时间够 -> 不触发
    await innerCursor.tick();
    expect(context.llm.generateJson).not.toHaveBeenCalled();
  });
});
