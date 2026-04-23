import fs from "node:fs/promises";
import path from "node:path";
import mime from "mime";
import type { StreamingTtsProvider, TtsAudioStream, TtsPlaybackResult, TtsStreamArtifact, TtsSynthesisOptions } from "./types.js";

export interface KokoroTtsProviderOptions {
  baseUrl?: string;
  endpointPath?: string;
  playEndpointPath?: string;
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
  private readonly playEndpointPath: string;
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
    this.playEndpointPath = options.playEndpointPath ?? process.env.KOKORO_TTS_PLAY_ENDPOINT_PATH ?? "/v1/audio/speech/play";
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
      const audio = options?.stream ? await this.streamAudio(text, { ...options, index }) : await this.generateAudio(text, options);
      artifacts.push(
        "chunks" in audio
          ? await this.writeAudioStream(audio.chunks, audio.mimeType, text, index++, options)
          : await this.writeAudio(audio.buffer, audio.mimeType, text, index++, options)
      );
    }
    return artifacts;
  }

  async *streamTextStream(chunks: AsyncIterable<string>, options?: TtsSynthesisOptions): AsyncIterable<TtsAudioStream> {
    let index = 0;
    for await (const chunk of chunks) {
      const text = chunk.trim();
      if (!text) continue;
      yield this.streamAudio(text, { ...options, index: index++ });
    }
  }

  async streamAudio(text: string, options?: TtsSynthesisOptions & { index?: number }): Promise<TtsAudioStream> {
    const response = await this.requestSpeech(text, { ...options, stream: true });
    return {
      index: options?.index ?? 0,
      text,
      mimeType: normalizeMimeType(response.headers.get("content-type"), this.responseFormat),
      chunks: responseToChunks(response),
    };
  }

  async playToDevice(text: string, options?: TtsSynthesisOptions): Promise<TtsPlaybackResult> {
    const response = await this.requestSpeechPlayback(text, options);
    const data = (await response.json()) as Record<string, unknown>;
    return {
      status: String(data.status ?? "ok"),
      engine: String(data.engine ?? "kokoro"),
      sampleRate: Number(data.sample_rate ?? 24000),
      voice: String(data.voice ?? options?.voiceName ?? this.voiceName),
      language: String(data.language ?? options?.language ?? this.language ?? ""),
      textLength: Number(data.text_length ?? text.length),
      device: String(data.device ?? ""),
      frames: Number(data.frames ?? 0),
      chunks: Number(data.chunks ?? 0),
      durationMs: Number(data.duration_ms ?? 0),
    };
  }

  private async generateAudio(
    text: string,
    options?: TtsSynthesisOptions
  ): Promise<{ buffer: Buffer<ArrayBufferLike>; mimeType: string }> {
    const response = await this.requestSpeech(text, options);
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: normalizeMimeType(response.headers.get("content-type"), this.responseFormat),
    };
  }

  private async requestSpeech(text: string, options?: TtsSynthesisOptions): Promise<Response> {
    const responseFormat = this.responseFormatFor(options);
    const response = await this.fetcher(this.url(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: responseFormat === "mp3" ? "audio/mpeg" : `audio/${responseFormat}`,
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(this.requestBody(text, options)),
    });
    if (!response.ok) {
      const detail = await safeReadText(response);
      throw new Error(`Kokoro TTS request failed with ${response.status}: ${detail || response.statusText}`);
    }
    return response;
  }

  private async requestSpeechPlayback(text: string, options?: TtsSynthesisOptions): Promise<Response> {
    const response = await this.fetcher(this.playUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(this.requestBody(text, { ...options, stream: false })),
    });
    if (!response.ok) {
      const detail = await safeReadText(response);
      throw new Error(`Kokoro TTS playback failed with ${response.status}: ${detail || response.statusText}`);
    }
    return response;
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

  private async writeAudioStream(
    chunks: AsyncIterable<Uint8Array>,
    mimeType: string,
    text: string,
    index: number,
    options?: TtsSynthesisOptions
  ): Promise<TtsStreamArtifact> {
    const outputDir = path.resolve(options?.outputDir ?? this.outputDir);
    await fs.mkdir(outputDir, { recursive: true });
    const extension = mime.getExtension(mimeType) ?? this.responseFormatFor(options);
    const filePrefix = options?.filePrefix ?? "kokoro-tts";
    const filePath = path.join(outputDir, `${filePrefix}-${String(index).padStart(3, "0")}.${extension}`);
    const file = await fs.open(filePath, "w");
    let byteLength = 0;
    try {
      for await (const chunk of chunks) {
        byteLength += chunk.byteLength;
        await file.write(chunk);
      }
    } finally {
      await file.close();
    }
    return {
      index,
      path: filePath,
      mimeType,
      byteLength,
      text,
    };
  }

  private url(): string {
    return `${this.baseUrl}${this.endpointPath.startsWith("/") ? "" : "/"}${this.endpointPath}`;
  }

  private playUrl(): string {
    return `${this.baseUrl}${this.playEndpointPath.startsWith("/") ? "" : "/"}${this.playEndpointPath}`;
  }

  private requestBody(text: string, options?: TtsSynthesisOptions): Record<string, string | number | boolean> {
    const voice = options?.voiceName ?? this.voiceName;
    const language = options?.language ?? (voice.startsWith("z") ? this.language : undefined);
    return {
      model: this.model,
      input: text,
      voice,
      response_format: this.responseFormatFor(options),
      ...(typeof options?.speed === "number" ? { speed: options.speed } : {}),
      ...(language ? { language } : {}),
      ...(options?.stream ? { stream: true } : {}),
      ...(options?.outputDevice !== undefined ? { output_device: options.outputDevice } : {}),
    };
  }

  private responseFormatFor(_options?: TtsSynthesisOptions): string {
    return this.responseFormat;
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

async function* responseToChunks(response: Response): AsyncIterable<Uint8Array> {
  if (!response.body) {
    yield new Uint8Array(await response.arrayBuffer());
    return;
  }
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value?.byteLength) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
