import { GoogleGenAI, ThinkingLevel, type Content } from "@google/genai";
import { loadStelleModelConfig, type StelleModelConfig } from "./StelleConfig.js";

const INTERNAL_TAGS = ["thought", "thinking", "analysis", "reasoning", "scratchpad", "chain_of_thought"];

export interface TextStreamDelta {
  type: "delta";
  index: number;
  text: string;
  timestamp: number;
}

export interface TextStreamDone {
  type: "done";
  index: number;
  text: string;
  timestamp: number;
}

export type TextStreamEvent = TextStreamDelta | TextStreamDone;

export interface SentenceChunkerOptions {
  maxChars?: number;
  minCharsBeforePunctuation?: number;
}

const SENTENCE_END = /[\u3002\uff01\uff1f.!?\n]\s*/u;

export function sanitizeExternalText(value: unknown): string {
  return sanitizeExternalTextRaw(value).trim();
}

export function sanitizeExternalTextChunk(value: unknown): string {
  return sanitizeExternalTextRaw(value);
}

export function sanitizeExternalTextOrFallback(value: unknown, fallback: string): string {
  return sanitizeExternalText(value) || fallback;
}

function sanitizeExternalTextRaw(value: unknown): string {
  let text = String(value ?? "");
  for (const tag of INTERNAL_TAGS) {
    const closedBlock = new RegExp(`<\\s*${tag}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${tag}\\s*>`, "gi");
    text = text.replace(closedBlock, "");
    const danglingBlock = new RegExp(`<\\s*${tag}\\b[^>]*>[\\s\\S]*$`, "gi");
    text = text.replace(danglingBlock, "");
  }
  text = text
    .replace(/<\s*\/?\s*(?:thought|thinking|analysis|reasoning|scratchpad|chain_of_thought)\b[^>]*>/gi, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return text;
}

export async function* textEventsFromChunks(chunks: AsyncIterable<string>): AsyncIterable<TextStreamEvent> {
  let index = 0;
  let text = "";
  for await (const raw of chunks) {
    const chunk = sanitizeExternalTextChunk(raw);
    if (!chunk) continue;
    text += chunk;
    yield {
      type: "delta",
      index: index++,
      text: chunk,
      timestamp: Date.now(),
    };
  }
  yield {
    type: "done",
    index,
    text: sanitizeExternalText(text),
    timestamp: Date.now(),
  };
}

export async function collectTextStream(chunks: AsyncIterable<string>): Promise<string> {
  const parts: string[] = [];
  for await (const chunk of chunks) parts.push(chunk);
  return sanitizeExternalText(parts.join(""));
}

export async function* sentenceChunksFromTextStream(
  chunks: AsyncIterable<string>,
  options: SentenceChunkerOptions = {}
): AsyncIterable<string> {
  const chunker = new SentenceChunker(options);
  for await (const chunk of chunks) {
    for (const ready of chunker.push(chunk)) yield ready;
  }
  const tail = chunker.flush();
  if (tail) yield tail;
}

export class SentenceChunker {
  private buffer = "";
  private readonly maxChars: number;
  private readonly minCharsBeforePunctuation: number;

  constructor(options: SentenceChunkerOptions = {}) {
    this.maxChars = options.maxChars ?? 48;
    this.minCharsBeforePunctuation = options.minCharsBeforePunctuation ?? 4;
  }

  push(raw: string): string[] {
    this.buffer += sanitizeExternalTextChunk(raw);
    return this.takeReady();
  }

  flush(): string {
    const tail = sanitizeExternalText(this.buffer);
    this.buffer = "";
    return tail;
  }

  private takeReady(): string[] {
    const chunks: string[] = [];
    while (this.buffer.length) {
      const punctuation = SENTENCE_END.exec(this.buffer);
      if (punctuation && punctuation.index + punctuation[0].length >= this.minCharsBeforePunctuation) {
        const end = punctuation.index + punctuation[0].length;
        const chunk = sanitizeExternalText(this.buffer.slice(0, end));
        if (chunk) chunks.push(chunk);
        this.buffer = this.buffer.slice(end);
        continue;
      }
      const chars = Array.from(this.buffer);
      if (chars.length < this.maxChars) break;
      const chunk = sanitizeExternalText(chars.slice(0, this.maxChars).join(""));
      if (chunk) chunks.push(chunk);
      this.buffer = chars.slice(this.maxChars).join("");
    }
    return chunks;
  }
}

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

  async generateText(
    prompt: string,
    options?: { role?: GeminiModelRole; temperature?: number; maxOutputTokens?: number; contents?: Content[] }
  ): Promise<string> {
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
