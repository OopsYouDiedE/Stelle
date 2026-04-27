import "dotenv/config";
import { describe, it } from "vitest";
import { LlmClient } from "../../src/utils/llm.js";
import fs from "node:fs/promises";
import path from "node:path";

const hasGemini = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "test-key";
const hasDashscope = !!process.env.DASHSCOPE_API_KEY && process.env.DASHSCOPE_API_KEY !== "test-key";

async function logEvalResult(modelId: string, prompt: string, latency: number, result: string, error?: string) {
  const logDir = path.resolve("evals/logs");
  await fs.mkdir(logDir, { recursive: true });
  const logPath = path.join(logDir, "llm_stress_report.md");
  
  const content = [
    `### Eval: ${modelId} @ ${new Date().toISOString()}`,
    `- **Prompt**: \`${prompt}\``,
    `- **Latency**: ${latency}ms`,
    `- **Status**: ${error ? "❌ Error" : "✅ Success"}`,
    ``,
    `#### Output`,
    `\`\`\``,
    error ? error : result,
    `\`\`\``,
    `\n---\n`
  ].join("\n");

  await fs.appendFile(logPath, content, "utf8");
}

describe("Multi-Model Stress & Retry Test", () => {
  it.skipIf(!hasGemini)(`should evaluate Gemini model`, async () => {
    const modelId = "gemini-2.5-flash";
    const llm = new LlmClient({
      geminiApiKey: process.env.GEMINI_API_KEY || "",
      dashscopeApiKey: process.env.DASHSCOPE_API_KEY || "",
      primaryModel: modelId,
      secondaryModel: modelId,
      ttsModel: "",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    });

    const prompt = 'Reply exactly "OK".';
    const start = Date.now();
    try {
      const res = await llm.generateText(prompt, { maxOutputTokens: 10 });
      const latency = Date.now() - start;
      await logEvalResult(modelId, prompt, latency, res);
    } catch (e) {
      const latency = Date.now() - start;
      await logEvalResult(modelId, prompt, latency, "", String(e));
    }
  }, 60000);

  it.skipIf(!hasDashscope)(`should evaluate Qwen model`, async () => {
    const modelId = "qwen-plus";
    const llm = new LlmClient({
      geminiApiKey: process.env.GEMINI_API_KEY || "",
      dashscopeApiKey: process.env.DASHSCOPE_API_KEY || "",
      primaryModel: modelId,
      secondaryModel: modelId,
      ttsModel: "",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    });

    const prompt = 'Reply exactly "OK".';
    const start = Date.now();
    try {
      const res = await llm.generateText(prompt, { maxOutputTokens: 10 });
      const latency = Date.now() - start;
      await logEvalResult(modelId, prompt, latency, res);
    } catch (e) {
      const latency = Date.now() - start;
      await logEvalResult(modelId, prompt, latency, "", String(e));
    }
  }, 60000);
});
