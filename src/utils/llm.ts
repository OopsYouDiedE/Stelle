/**
 * Module: LLM client wrapper
 *
 * Runtime flow:
 * - Wraps Gemini text, JSON, streaming, and URI-based multimodal inputs.
 * - Cursors call generateText/generateJson/streamText without depending on SDK request details.
 * - JSON parse failures become LlmJsonParseError so callers can choose a safe fallback.
 */
import { createPartFromUri, GoogleGenAI, ThinkingLevel, type Content, type Part } from "@google/genai";
import type { ModelConfig } from "./config_loader.js";
import { loadModelConfig } from "./config_loader.js";
import { parseJsonObject, safeErrorMessage } from "./json.js";
import { sanitizeExternalText, sanitizeExternalTextChunk } from "./text.js";

export type LlmRole = "primary" | "secondary";

export interface LlmUriPart {
  uri: string;
  mimeType: string;
}

export interface LlmOptions {
  role?: LlmRole;
  temperature?: number;
  maxOutputTokens?: number;
  contents?: Content[];
  uriParts?: LlmUriPart[];
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
      contents: options.contents ?? this.createContents(prompt, options.uriParts),
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

  private createContents(prompt: string, uriParts: LlmUriPart[] = []): Content[] {
    const parts: Part[] = [{ text: prompt }];
    for (const part of uriParts) {
      parts.push(createPartFromUri(part.uri, part.mimeType));
    }
    return [{ role: "user", parts }];
  }
}
