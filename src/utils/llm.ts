/**
 * Module: Clean Multi-provider LLM Client with Native JSON Mode
 */

import { GoogleGenAI } from "@google/genai";
import { parseJsonObject, safeErrorMessage } from "./json.js";
import { sanitizeExternalText } from "./text.js";
import { loadModelConfig, type ModelConfig } from "./config_loader.js";

export type LlmRole = "primary" | "secondary";

export interface LlmOptions {
  role?: LlmRole;
  temperature?: number;
  maxOutputTokens?: number;
  isFallback?: boolean;
  jsonMode?: boolean; // 新增：是否开启强制 JSON 模式
}

export class LlmJsonParseError extends Error {
  constructor(message: string, readonly rawText: string) {
    super(message);
    this.name = "LlmJsonParseError";
  }
}

export class LlmClient {
  private readonly geminiSDK: GoogleGenAI | null = null;

  constructor(readonly config: ModelConfig = loadModelConfig()) {
    if (config.geminiApiKey) {
      this.geminiSDK = new GoogleGenAI({ apiKey: config.geminiApiKey });
    }
  }

  private modelFor(role: LlmRole, isFallback: boolean): string {
    if (isFallback) return "qwen-plus";
    return role === "primary" ? this.config.primaryModel : this.config.secondaryModel;
  }

  async generateText(prompt: string, options: LlmOptions = {}): Promise<string> {
    let retries = 0;
    const maxRetries = 8;
    const modelId = this.modelFor(options.role ?? "primary", options.isFallback || false);

    while (retries <= maxRetries) {
      try {
        if (modelId.startsWith("qwen")) {
          return await this.requestDashScope(modelId, prompt, options);
        } else {
          return await this.requestGemini(modelId, prompt, options);
        }
      } catch (e: any) {
        const status = e?.status || 0;
        if ((status === 429 || status === 503) && retries < maxRetries) {
          const delay = Math.pow(1.5, retries) * 500 + Math.random() * 100;
          await new Promise(r => setTimeout(r, delay));
          retries++;
          continue;
        }
        if (!options.isFallback) return this.generateText(prompt, { ...options, isFallback: true });
        throw e;
      }
    }
    throw new Error("LLM Max retries exceeded");
  }

  private async requestDashScope(modelId: string, prompt: string, options: LlmOptions): Promise<string> {
    if (!this.config.dashscopeApiKey) throw new Error("Missing DASHSCOPE_API_KEY");
    
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.config.dashscopeApiKey}`
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: prompt }],
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxOutputTokens ?? 1000,
        // 关键：Qwen 的 JSON Mode
        ...(options.jsonMode ? { response_format: { type: "json_object" } } : {})
      })
    });

    if (!response.ok) throw new Error(`DashScope Error: ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  }

  private async requestGemini(modelId: string, prompt: string, options: LlmOptions): Promise<string> {
    if (!this.geminiSDK) throw new Error("Missing GEMINI_API_KEY");
    
    const response = await this.geminiSDK.models.generateContent({
      model: modelId,
      config: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxOutputTokens ?? 1000,
        ...(options.jsonMode ? { responseMimeType: "application/json" } : {}),
      },
      contents: prompt,
    });
    return response.text ?? "";
  }

  async generateJson<T>(prompt: string, schema: string, norm: (r: any) => T, opts: LlmOptions = {}): Promise<T> {
    // 强制在 Prompt 中包含 "JSON" 字样，这是开启 JSON Mode 的前置要求
    const enhancedPrompt = `${prompt}\n\nIMPORTANT: Respond strictly in valid JSON format.`;
    const text = await this.generateText(enhancedPrompt, { ...opts, jsonMode: true });
    
    const parsed = parseJsonObject(text);
    if (!parsed) throw new LlmJsonParseError(`Invalid JSON for ${schema}`, text);
    try {
        return norm(parsed);
    } catch (e) {
        throw new LlmJsonParseError(`Norm error: ${safeErrorMessage(e)}`, text);
    }
  }

  async *streamText(prompt: string, options: LlmOptions = {}): AsyncIterable<string> {
    const res = await this.generateText(prompt, options);
    yield sanitizeExternalText(res);
  }
}
