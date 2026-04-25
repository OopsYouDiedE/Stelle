/**
 * 模块：LLM 客户端封装
 *
 * 运行逻辑：
 * - 统一封装 Gemini 文本、JSON 和流式文本调用。
 * - Cursor 只关心 generateText/generateJson/streamText，不直接依赖 SDK 细节。
 * - JSON 调用失败会抛 `LlmJsonParseError`，由 Cursor 决定降级为 drop/wait/reply。
 *
 * 主要方法：
 * - `generateText()`：普通文本生成。
 * - `generateJson()`：文本生成后提取 JSON 并交给 normalize。
 * - `streamText()`：流式输出，用于未来 TTS/字幕。
 */
import { GoogleGenAI, ThinkingLevel, type Content } from "@google/genai";
import type { ModelConfig } from "./config_loader.js";
import { loadModelConfig } from "./config_loader.js";
import { parseJsonObject, safeErrorMessage } from "./json.js";
import { sanitizeExternalText, sanitizeExternalTextChunk } from "./text.js";

export type LlmRole = "primary" | "secondary";

export interface LlmOptions {
  role?: LlmRole;
  temperature?: number;
  maxOutputTokens?: number;
  contents?: Content[];
}

export class LlmJsonParseError extends Error {
  constructor(
    message: string,
    readonly rawText: string
  ) {
    super(message);
    this.name = "LlmJsonParseError";
  }
}

export class LlmClient {
  private readonly ai: GoogleGenAI;

  constructor(readonly config: ModelConfig = loadModelConfig(), ai?: GoogleGenAI) {
    this.ai = ai ?? this.createClient();
  }

  modelFor(role: LlmRole): string {
    return role === "primary" ? this.config.primaryModel : this.config.secondaryModel;
  }

  async generateText(prompt: string, options: LlmOptions = {}): Promise<string> {
    const parts: string[] = [];
    for await (const chunk of this.streamText(prompt, options)) parts.push(chunk);
    return sanitizeExternalText(parts.join(""));
  }

  async generateJson<T>(
    prompt: string,
    schemaName: string,
    normalize: (raw: unknown) => T,
    options: LlmOptions = {}
  ): Promise<T> {
    const text = await this.generateText(prompt, options);
    const parsed = parseJsonObject(text);
    if (!parsed) {
      throw new LlmJsonParseError(`LLM did not return valid JSON for ${schemaName}.`, text);
    }
    try {
      return normalize(parsed);
    } catch (error) {
      throw new LlmJsonParseError(`LLM JSON failed normalization for ${schemaName}: ${safeErrorMessage(error)}`, text);
    }
  }

  async *streamText(prompt: string, options: LlmOptions = {}): AsyncIterable<string> {
    if (!this.config.apiKey) throw new Error("Missing Gemini API key.");
    const response = await this.ai.models.generateContentStream({
      model: this.modelFor(options.role ?? "primary"),
      config: {
        temperature: options.temperature ?? 0.7,
        ...(typeof options.maxOutputTokens === "number" ? { maxOutputTokens: options.maxOutputTokens } : {}),
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
      contents: options.contents ?? [{ role: "user", parts: [{ text: prompt }] }],
    });

    for await (const chunk of response) {
      const text = sanitizeExternalTextChunk(chunk.text ?? "");
      if (text) yield text;
    }
  }

  private createClient(): GoogleGenAI {
    return new GoogleGenAI({
      apiKey: this.config.apiKey,
      httpOptions: {
        apiVersion: "v1beta",
        ...(this.config.baseUrl ? { baseUrl: this.config.baseUrl } : {}),
      },
    });
  }
}
