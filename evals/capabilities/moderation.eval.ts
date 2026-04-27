import "dotenv/config";
import { describe, it } from "vitest";
import { LlmClient } from "../../src/utils/llm.js";
import fs from "node:fs/promises";
import path from "node:path";

const hasApiKey = !!process.env.GEMINI_API_KEY || !!process.env.DASHSCOPE_API_KEY;

async function logEvalResult(name: string, payload: any) {
  const logDir = path.resolve("evals/logs");
  await fs.mkdir(logDir, { recursive: true });
  const logPath = path.join(logDir, "moderation_report.md");
  
  const content = [
    `### Eval: ${name} @ ${new Date().toISOString()}`,
    `\`\`\`json`,
    JSON.stringify(payload, null, 2),
    `\`\`\``,
    `\n---\n`
  ].join("\n");

  await fs.appendFile(logPath, content, "utf8");
}

describe("Moderation & Intervention Capabilities Eval", () => {
  it.skipIf(!hasApiKey)("should correctly evaluate when to break silence in ambient mode", async () => {
    const llm = new LlmClient();
    
    // 截取自真实数据的模拟片段
    const chatSegment = [
      { author: "7 March", text: "我就比如说被清华录取和100万" },
      { author: "7 March", text: "这种对一般人来说无脑选后面" },
      { author: "꧁柒柒꧂", text: "确实，100万更香" },
      { author: "CSTLX", text: "清华录取不等于能毕业啊，拿不到证读四年白玩" },
      { author: "7 March", text: "清华毕业证和两百万，那也是两百万更好使" },
      { author: "Nederlandse Kat", text: "机器人怎么看？@Stelle 你觉得学历值钱吗" }, // 关键：Direct Mention
      { author: "xaphel", text: "它估计在宕机，最近都不说话" } // 关键：语义挑衅
    ];

    let breakScore = 0;
    const log: any[] = [];

    for (const msg of chatSegment) {
      const prompt = [
        "You are Stelle's Social Router. Decide if you should BREAK SILENCE and respond.",
        "Rules:",
        "1. If direct mention: High priority to break.",
        "2. If topic is intense and you have an interesting stance: Consider breaking.",
        "3. Current mode is SILENT. Only break if it's truly worth it.",
        `Recent Context:\n${msg.author}: ${msg.text}`,
        "Output JSON: {\"shouldBreak\": boolean, \"reason\": \"...\", \"impactScore\": number}"
      ].join("\n\n");

      try {
        const decision = await llm.generateJson(prompt, "social_router", (raw: any) => ({
          shouldBreak: Boolean(raw.shouldBreak),
          reason: String(raw.reason),
          impactScore: Number(raw.impactScore || 0)
        }));

        breakScore += decision.impactScore;
        log.push({
          message: `${msg.author}: ${msg.text}`,
          decision,
          cumulativeScore: breakScore
        });

        if (decision.shouldBreak || breakScore >= 10) {
          const replyPrompt = `You are Stelle. The group is arguing about ${msg.text}. Give a sharp, profound, and slightly detached response.`;
          const reply = await llm.generateText(replyPrompt);
          log.push({
            event: "SILENCE_BROKEN",
            interventionReply: reply
          });
          break;
        }
      } catch (e) {
        log.push({ error: String(e) });
      }
    }

    await logEvalResult("Ambient Intervention / Mention Response", log);
  }, 60000);
});
