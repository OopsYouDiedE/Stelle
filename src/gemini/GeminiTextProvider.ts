import { GoogleGenAI, ThinkingLevel, type Content } from "@google/genai";
import { loadStelleModelConfig, type StelleModelConfig } from "../config/StelleConfig.js";
import { sanitizeExternalTextChunk } from "../text/sanitize.js";
import { collectTextStream, textEventsFromChunks, type TextStreamEvent } from "../text/TextStream.js";

export type GeminiModelRole = "primary" | "secondary";

export interface GeminiTextProviderOptions {
  config?: StelleModelConfig;
  ai?: GoogleGenAI;
}

export class GeminiTextProvider {
  readonly config: StelleModelConfig;
  private readonly ai: GoogleGenAI;

  constructor(options: GeminiTextProviderOptions = {}) {
    this.config = options.config ?? loadStelleModelConfig();
    this.ai = options.ai ?? this.createClient();
  }

  modelFor(role: GeminiModelRole): string {
    return role === "primary" ? this.config.primaryModel : this.config.secondaryModel;
  }

  async generateText(prompt: string, options?: { role?: GeminiModelRole; temperature?: number; maxOutputTokens?: number; contents?: Content[] }): Promise<string> {
    return collectTextStream(this.generateTextStream(prompt, options));
  }

  generateTextEvents(
    prompt: string,
    options?: { role?: GeminiModelRole; temperature?: number; maxOutputTokens?: number; contents?: Content[] }
  ): AsyncIterable<TextStreamEvent> {
    return textEventsFromChunks(this.generateTextStream(prompt, options));
  }

  async *generateTextStream(
    prompt: string,
    options?: { role?: GeminiModelRole; temperature?: number; maxOutputTokens?: number; contents?: Content[] }
  ): AsyncIterable<string> {
    if (!this.config.apiKey) throw new Error("Missing Gemini API key.");
    const response = await this.ai.models.generateContentStream({
      model: this.modelFor(options?.role ?? "primary"),
      config: {
        temperature: options?.temperature ?? 0.7,
        ...(typeof options?.maxOutputTokens === "number" ? { maxOutputTokens: options.maxOutputTokens } : {}),
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.MINIMAL,
        },
      },
      contents: options?.contents ?? [{ role: "user", parts: [{ text: prompt }] }],
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
