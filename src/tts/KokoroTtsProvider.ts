import fs from "node:fs/promises";
import path from "node:path";
import mime from "mime";
import type { StreamingTtsProvider, TtsStreamArtifact, TtsSynthesisOptions } from "./types.js";

export interface KokoroTtsProviderOptions {
  baseUrl?: string;
  endpointPath?: string;
  apiKey?: string;
  model?: string;
  voiceName?: string;
  language?: string;
  responseFormat?: string;
  outputDir?: string;
  fetcher?: typeof fetch;
}

export class KokoroTtsProvider implements StreamingTtsProvider {
  private readonly baseUrl: string;
  private readonly endpointPath: string;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly voiceName: string;
  private readonly language?: string;
  private readonly responseFormat: string;
  private readonly outputDir: string;
  private readonly fetcher: typeof fetch;

  constructor(options: KokoroTtsProviderOptions = {}) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? process.env.KOKORO_TTS_BASE_URL ?? "http://127.0.0.1:8880");
    this.endpointPath = options.endpointPath ?? process.env.KOKORO_TTS_ENDPOINT_PATH ?? "/v1/audio/speech";
    this.apiKey = options.apiKey ?? process.env.KOKORO_TTS_API_KEY;
    this.model = options.model ?? process.env.KOKORO_TTS_MODEL ?? "kokoro";
    this.voiceName = options.voiceName ?? process.env.KOKORO_TTS_VOICE ?? "zf_xiaobei";
    this.language = options.language ?? process.env.KOKORO_TTS_LANGUAGE;
    this.responseFormat = options.responseFormat ?? process.env.KOKORO_TTS_RESPONSE_FORMAT ?? "wav";
    this.outputDir = options.outputDir ?? "artifacts/tts";
    this.fetcher = options.fetcher ?? fetch;
  }

  async synthesizeToFiles(text: string, options?: TtsSynthesisOptions): Promise<TtsStreamArtifact[]> {
    return this.synthesizeTextStream(single(text), options);
  }

  async synthesizeTextStream(chunks: AsyncIterable<string>, options?: TtsSynthesisOptions): Promise<TtsStreamArtifact[]> {
    const artifacts: TtsStreamArtifact[] = [];
    let index = 0;
    for await (const chunk of chunks) {
      const text = chunk.trim();
      if (!text) continue;
      const audio = await this.generateAudio(text, options);
      artifacts.push(await this.writeAudio(audio.buffer, audio.mimeType, text, index++, options));
    }
    return artifacts;
  }

  private async generateAudio(
    text: string,
    options?: TtsSynthesisOptions
  ): Promise<{ buffer: Buffer<ArrayBufferLike>; mimeType: string }> {
    const response = await this.fetcher(this.url(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: this.responseFormat === "mp3" ? "audio/mpeg" : `audio/${this.responseFormat}`,
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(this.requestBody(text, options)),
    });
    if (!response.ok) {
      const detail = await safeReadText(response);
      throw new Error(`Kokoro TTS request failed with ${response.status}: ${detail || response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: normalizeMimeType(response.headers.get("content-type"), this.responseFormat),
    };
  }

  private async writeAudio(
    buffer: Buffer<ArrayBufferLike>,
    mimeType: string,
    text: string,
    index: number,
    options?: TtsSynthesisOptions
  ): Promise<TtsStreamArtifact> {
    const outputDir = path.resolve(options?.outputDir ?? this.outputDir);
    await fs.mkdir(outputDir, { recursive: true });
    const extension = mime.getExtension(mimeType) ?? this.responseFormat;
    const filePrefix = options?.filePrefix ?? "kokoro-tts";
    const filePath = path.join(outputDir, `${filePrefix}-${String(index).padStart(3, "0")}.${extension}`);
    await fs.writeFile(filePath, buffer);
    return {
      index,
      path: filePath,
      mimeType,
      byteLength: buffer.byteLength,
      text,
    };
  }

  private url(): string {
    return `${this.baseUrl}${this.endpointPath.startsWith("/") ? "" : "/"}${this.endpointPath}`;
  }

  private requestBody(text: string, options?: TtsSynthesisOptions): Record<string, string | number> {
    const voice = options?.voiceName ?? this.voiceName;
    const language = options?.language ?? (voice.startsWith("z") ? this.language : undefined);
    return {
      model: this.model,
      input: text,
      voice,
      response_format: this.responseFormat,
      ...(typeof options?.speed === "number" ? { speed: options.speed } : {}),
      ...(language ? { language } : {}),
    };
  }
}

async function* single(text: string): AsyncIterable<string> {
  yield text;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeMimeType(contentType: string | null, fallbackFormat: string): string {
  const mediaType = contentType?.split(";")[0]?.trim();
  if (mediaType) return mediaType;
  return fallbackFormat === "mp3" ? "audio/mpeg" : `audio/${fallbackFormat}`;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
