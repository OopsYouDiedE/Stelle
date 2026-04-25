/**
 * 模块：Kokoro TTS 文件生成
 *
 * 运行逻辑：
 * - 将文本切成句子后逐段请求 Kokoro HTTP 服务。
 * - 返回写入本地 artifacts 的音频文件列表，供工具层或 renderer 后续播放。
 * - 如果 Kokoro 服务不可用，错误向上抛给工具层形成 ToolResult。
 *
 * 主要类：
 * - `KokoroTtsProvider`：StreamingTtsProvider 的 Kokoro 实现。
 * - `synthesizeToFiles()`：文本到音频 artifact 的主入口。
 */
import fs from "node:fs/promises";
import path from "node:path";
import mime from "mime";

export interface TtsStreamArtifact {
  index: number;
  path: string;
  mimeType: string;
  byteLength: number;
  text: string;
}

export interface TtsSynthesisOptions {
  outputDir?: string;
  filePrefix?: string;
  voiceName?: string;
  speed?: number;
  language?: string;
  stream?: boolean;
  outputDevice?: string | number;
}

export interface StreamingTtsProvider {
  synthesizeToFiles(text: string, options?: TtsSynthesisOptions): Promise<TtsStreamArtifact[]>;
  synthesizeTextStream(chunks: AsyncIterable<string>, options?: TtsSynthesisOptions): Promise<TtsStreamArtifact[]>;
}

export class KokoroTtsProvider implements StreamingTtsProvider {
  private readonly baseUrl: string;
  private readonly endpointPath: string;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly voiceName: string;
  private readonly responseFormat: string;
  private readonly outputDir: string;

  constructor(options: { baseUrl?: string; endpointPath?: string; apiKey?: string; model?: string; voiceName?: string; responseFormat?: string; outputDir?: string } = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.KOKORO_TTS_BASE_URL ?? "http://127.0.0.1:8880").replace(/\/+$/, "");
    this.endpointPath = options.endpointPath ?? process.env.KOKORO_TTS_ENDPOINT_PATH ?? "/v1/audio/speech";
    this.apiKey = options.apiKey ?? process.env.KOKORO_TTS_API_KEY;
    this.model = options.model ?? process.env.KOKORO_TTS_MODEL ?? "kokoro";
    this.voiceName = options.voiceName ?? process.env.KOKORO_TTS_VOICE ?? "zf_xiaobei";
    this.responseFormat = options.responseFormat ?? process.env.KOKORO_TTS_RESPONSE_FORMAT ?? "wav";
    this.outputDir = options.outputDir ?? "artifacts/tts";
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
      artifacts.push(await this.writeAudio(await this.requestSpeech(text, options), text, index++, options));
    }
    return artifacts;
  }

  private async requestSpeech(text: string, options?: TtsSynthesisOptions): Promise<{ buffer: Buffer; mimeType: string }> {
    const responseFormat = this.responseFormat;
    const response = await fetch(`${this.baseUrl}${this.endpointPath.startsWith("/") ? "" : "/"}${this.endpointPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: responseFormat === "mp3" ? "audio/mpeg" : `audio/${responseFormat}`,
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        voice: options?.voiceName ?? this.voiceName,
        response_format: responseFormat,
        ...(typeof options?.speed === "number" ? { speed: options.speed } : {}),
        ...(options?.language ? { language: options.language } : {}),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Kokoro TTS failed with ${response.status}: ${detail || response.statusText}`);
    }
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || `audio/${responseFormat}`;
    return { buffer: Buffer.from(await response.arrayBuffer()), mimeType };
  }

  private async writeAudio(audio: { buffer: Buffer; mimeType: string }, text: string, index: number, options?: TtsSynthesisOptions): Promise<TtsStreamArtifact> {
    const outputDir = path.resolve(options?.outputDir ?? this.outputDir);
    await fs.mkdir(outputDir, { recursive: true });
    const extension = mime.getExtension(audio.mimeType) ?? this.responseFormat;
    const filePrefix = options?.filePrefix ?? "kokoro-tts";
    const filePath = path.join(outputDir, `${filePrefix}-${String(index).padStart(3, "0")}.${extension}`);
    await fs.writeFile(filePath, audio.buffer);
    return { index, path: filePath, mimeType: audio.mimeType, byteLength: audio.buffer.byteLength, text };
  }
}

async function* single(text: string): AsyncIterable<string> {
  yield text;
}
