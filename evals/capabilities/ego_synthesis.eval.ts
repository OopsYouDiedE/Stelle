import "dotenv/config";
import { describe, it } from "vitest";
import { InnerCursor } from "../../src/cursor/inner_cursor.js";
import { LlmClient } from "../../src/utils/llm.js";
import fs from "node:fs/promises";
import path from "node:path";

const hasApiKey = !!process.env.GEMINI_API_KEY || !!process.env.DASHSCOPE_API_KEY;

async function logEvalResult(name: string, payload: any) {
  const logDir = path.resolve("evals/logs");
  await fs.mkdir(logDir, { recursive: true });
  const logPath = path.join(logDir, "ego_synthesis_report.md");
  
  const content = [
    `### Eval: ${name} @ ${new Date().toISOString()}`,
    `\`\`\`json`,
    JSON.stringify(payload, null, 2),
    `\`\`\``,
    `\n---\n`
  ].join("\n");

  await fs.appendFile(logPath, content, "utf8");
}

describe("Ego Synthesis Capabilities Eval", () => {
  it.skipIf(!hasApiKey)("should successfully synthesize core convictions from chaotic input", async () => {
    const llm = new LlmClient();
    
    // 模拟的内存存储
    const memoryData: Record<string, string> = {};
    const memoryMock: any = {
      readLongTerm: async (key: string) => memoryData[key] || null,
      writeLongTerm: async (key: string, value: string) => { memoryData[key] = value; }
    };

    const context: any = {
      now: () => Date.now(),
      config: { models: { apiKey: process.env.GEMINI_API_KEY || "dummy" } },
      llm,
      memory: memoryMock,
      publishEvent: () => {}
    };

    const inner = new InnerCursor(context);
    await inner.initialize();

    const mockMessages = [
      "Stelle, 你觉得人工智能会有真正的自我意识吗？",
      "刚才那个直播间的弹幕太逆天了，全是带节奏的。",
      "我今天真的很不开心，被领导骂了。",
      "Stelle！快看我抽到了金卡！",
      "你们这些AI都是没有感情的机器罢了。"
    ];

    // 输入高强度事件触发合成
    for (const msg of mockMessages) {
      inner.receiveDispatch({
        type: "cursor.reflection",
        source: "discord",
        payload: {
          intent: "observe_chat",
          summary: `User: ${msg}`,
          impactScore: 8,
          salience: "high"
        },
        timestamp: Date.now()
      });
    }

    // 等待异步合成完成
    // 在真实环境 `triggerCognitiveSynthesis` 是后台异步跑的，但在我们的测试里因为注入了 5 个 high salience，
    // recordDecision 会直接 trigger，所以我们要等一会儿
    await new Promise(resolve => setTimeout(resolve, 8000));

    const snapshot = inner.snapshot();
    await logEvalResult("Ego Synthesis (Chaotic Inputs)", {
      finalMood: snapshot.state.globalMood,
      convictions: JSON.parse(memoryData["core_convictions"] || "[]"),
      directivesCount: snapshot.state.activeDirectivesCount
    });

  }, 30000);
});
