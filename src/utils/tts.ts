/**
 * 模块：直播 TTS 文件生成与浏览器代理请求
 *
 * 运行逻辑：
 * - 将文本切成句子后逐段请求配置的 TTS 服务。
 * - 返回写入本地 artifacts 的音频文件列表，供工具层或 renderer 后续播放。
 * - 直播 renderer 通过 `buildLiveTtsRequest()` 生成短期代理请求，再由 renderer 拉取真实音频。
 *
 * 主要类：
 * - `KokoroTtsProvider`：StreamingTtsProvider 的 Kokoro 实现。
 * - `DashScopeTtsProvider`：阿里云百炼 Qwen-TTS 实现。
 * - `synthesizeToFiles()`：文本到音频 artifact 的主入口。
 */

// === Imports ===
import fs from "node:fs/promises";
import path from "node:path";
import mime from "mime";
import WebSocket from "ws";

// === Types & Interfaces ===

export type TtsProviderName = "kokoro" | "dashscope";
export type LiveTtsTransport = "http_sse" | "realtime_ws";

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
  model?: string;
  instructions?: string;
  optimizeInstructions?: boolean;
  stream?: boolean;
  outputDevice?: string | number;
}

export interface LiveTtsRequest {
  provider: TtsProviderName;
  request: Record<string, unknown>;
}

export interface RealtimeTtsChunk {
  index: number;
  base64: string;
  byteLength: number;
  responseId?: string;
}

export interface DashScopeRealtimeTtsOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  voice?: string;
  mode?: "server_commit" | "commit";
  languageType?: string;
  responseFormat?: "pcm" | "wav" | "mp3" | "opus";
  sampleRate?: number;
  instructions?: string;
  optimizeInstructions?: boolean;
  timeoutMs?: number;
}

export interface DashScopeRealtimeSynthesisResult {
  sessionId?: string;
  responseId?: string;
  chunks: number;
  bytes: number;
  transport: "realtime_ws";
}

export interface StreamingTtsProvider {
  synthesizeToFiles(text: string, options?: TtsSynthesisOptions): Promise<TtsStreamArtifact[]>;
  synthesizeTextStream(chunks: AsyncIterable<string>, options?: TtsSynthesisOptions): Promise<TtsStreamArtifact[]>;
}

export class DashScopeRealtimeTtsClient {
  private ws?: WebSocket;
  private sessionId?: string;
  private connected = false;
  private sessionUpdated = false;
  private sessionUpdateWaiters: Array<{ resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }> =
    [];
  private pendingDone?: {
    resolve: (result: DashScopeRealtimeSynthesisResult) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
    responseId?: string;
    chunks: number;
    bytes: number;
  };
  private chunkHandler?: (chunk: RealtimeTtsChunk) => void;

  constructor(private readonly options: DashScopeRealtimeTtsOptions = {}) {}

  async synthesize(text: string, onChunk: (chunk: RealtimeTtsChunk) => void): Promise<DashScopeRealtimeSynthesisResult> {
    const clean = text.trim();
    if (!clean) return { chunks: 0, bytes: 0, transport: "realtime_ws" };

    await this.ensureConnected();
    this.chunkHandler = onChunk;
    const pending = this.createPending();
    this.send({
      event_id: realtimeEventId("append"),
      type: "input_text_buffer.append",
      text: clean,
    });
    this.send({
      event_id: realtimeEventId("commit"),
      type: "input_text_buffer.commit",
    });
    return pending;
  }

  async finish(): Promise<void> {
    if (!this.ws || !this.connected) return;
    this.send({ event_id: realtimeEventId("finish"), type: "session.finish" });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    this.close();
  }

  close(): void {
    this.connected = false;
    this.sessionUpdated = false;
    const ws = this.ws;
    this.ws = undefined;
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws && this.connected && this.sessionUpdated) return;
    const apiKey = this.options.apiKey ?? process.env.DASHSCOPE_API_KEY;
    if (!apiKey) throw new Error("Missing DASHSCOPE_API_KEY for DashScope Qwen-TTS Realtime.");

    const model =
      this.options.model ??
      process.env.QWEN_TTS_REALTIME_MODEL ??
      process.env.QWEN_TTS_MODEL?.replace(/(?:-instruct)?-flash$/, "-flash-realtime") ??
      "qwen3-tts-flash-realtime";
    const baseUrl =
      this.options.baseUrl ?? process.env.QWEN_TTS_REALTIME_WS_URL ?? "wss://dashscope.aliyuncs.com/api-ws/v1/realtime";
    const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}model=${encodeURIComponent(model)}`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("DashScope Realtime TTS websocket connection timed out."));
      }, this.options.timeoutMs ?? liveTtsTimeoutMs());

      ws.once("open", () => {
        clearTimeout(timer);
        this.ws = ws;
        this.connected = true;
        this.attachHandlers(ws);
        this.updateSession();
        resolve();
      });
      ws.once("error", (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
    if (!this.sessionUpdated) await this.waitForSessionUpdated();
  }

  private attachHandlers(ws: WebSocket): void {
    ws.on("message", (data) => this.handleMessage(String(data)));
    ws.on("close", (_code, reason) => {
      this.connected = false;
      this.sessionUpdated = false;
      this.rejectSessionWaiters(new Error(`DashScope Realtime TTS websocket closed: ${String(reason)}`));
      const pending = this.pendingDone;
      this.pendingDone = undefined;
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`DashScope Realtime TTS websocket closed: ${String(reason)}`));
      }
    });
    ws.on("error", (error) => {
      this.rejectSessionWaiters(error instanceof Error ? error : new Error(String(error)));
      const pending = this.pendingDone;
      this.pendingDone = undefined;
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private updateSession(): void {
    this.send({
      event_id: realtimeEventId("session"),
      type: "session.update",
      session: {
        voice: this.options.voice ?? process.env.QWEN_TTS_REALTIME_VOICE ?? process.env.QWEN_TTS_VOICE ?? "Cherry",
        mode: this.options.mode ?? "commit",
        language_type: this.options.languageType ?? process.env.QWEN_TTS_LANGUAGE_TYPE ?? "Chinese",
        response_format:
          this.options.responseFormat ??
          (process.env.QWEN_TTS_REALTIME_FORMAT as DashScopeRealtimeTtsOptions["responseFormat"]) ??
          "pcm",
        sample_rate: this.options.sampleRate ?? Number(process.env.QWEN_TTS_REALTIME_SAMPLE_RATE ?? 24000),
        ...(this.options.instructions ?? process.env.QWEN_TTS_INSTRUCTIONS
          ? { instructions: this.options.instructions ?? process.env.QWEN_TTS_INSTRUCTIONS }
          : {}),
        ...(typeof this.options.optimizeInstructions === "boolean"
          ? { optimize_instructions: this.options.optimizeInstructions }
          : process.env.QWEN_TTS_OPTIMIZE_INSTRUCTIONS
            ? { optimize_instructions: process.env.QWEN_TTS_OPTIMIZE_INSTRUCTIONS !== "false" }
            : {}),
      },
    });
  }

  private createPending(): Promise<DashScopeRealtimeSynthesisResult> {
    if (this.pendingDone) {
      throw new Error("DashScope Realtime TTS already has an active response.");
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingDone = undefined;
        reject(new Error("DashScope Realtime TTS response timed out."));
      }, this.options.timeoutMs ?? liveTtsTimeoutMs());
      this.pendingDone = { resolve, reject, timer, chunks: 0, bytes: 0 };
    });
  }

  private handleMessage(raw: string): void {
    let event: Record<string, any>;
    try {
      event = JSON.parse(raw) as Record<string, any>;
    } catch {
      return;
    }
    const type = String(event.type ?? "");

    if (type === "session.created") {
      this.sessionId = event.session?.id;
      return;
    }
    if (type === "session.updated") {
      this.sessionUpdated = true;
      this.sessionId = event.session?.id ?? this.sessionId;
      for (const waiter of this.sessionUpdateWaiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.resolve();
      }
      return;
    }
    if (type === "response.created") {
      if (this.pendingDone) this.pendingDone.responseId = event.response?.id;
      return;
    }
    if (type === "response.audio.delta") {
      const base64 = parseDashScopeRealtimeAudioDelta(event);
      if (!base64 || !this.pendingDone) return;
      const byteLength = Buffer.byteLength(base64, "base64");
      const chunk = {
        index: this.pendingDone.chunks++,
        base64,
        byteLength,
        responseId: this.pendingDone.responseId,
      };
      this.pendingDone.bytes += byteLength;
      this.chunkHandler?.(chunk);
      return;
    }
    if (type === "response.done" || type === "session.finished") {
      const pending = this.pendingDone;
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pendingDone = undefined;
      pending.resolve({
        sessionId: this.sessionId,
        responseId: pending.responseId,
        chunks: pending.chunks,
        bytes: pending.bytes,
        transport: "realtime_ws",
      });
      return;
    }
    if (type === "error") {
      const pending = this.pendingDone;
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pendingDone = undefined;
      pending.reject(new Error(String(event.error?.message ?? event.error ?? "DashScope Realtime TTS error")));
    }
  }

  private send(event: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("DashScope Realtime TTS websocket is not open.");
    this.ws.send(JSON.stringify(event));
  }

  private waitForSessionUpdated(): Promise<void> {
    if (this.sessionUpdated) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.sessionUpdateWaiters = this.sessionUpdateWaiters.filter((item) => item.timer !== timer);
        reject(new Error("DashScope Realtime TTS session.update timed out."));
      }, this.options.timeoutMs ?? liveTtsTimeoutMs());
      this.sessionUpdateWaiters.push({ resolve, reject, timer });
    });
  }

  private rejectSessionWaiters(error: Error): void {
    for (const waiter of this.sessionUpdateWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}

// === Core Logic ===

/**
 * Kokoro TTS 服务提供商
 */
export class KokoroTtsProvider implements StreamingTtsProvider {
  private readonly baseUrl: string;
  private readonly endpointPath: string;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly voiceName: string;
  private readonly responseFormat: string;
  private readonly outputDir: string;

  constructor(
    options: {
      baseUrl?: string;
      endpointPath?: string;
      apiKey?: string;
      model?: string;
      voiceName?: string;
      responseFormat?: string;
      outputDir?: string;
    } = {},
  ) {
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

  async synthesizeTextStream(
    chunks: AsyncIterable<string>,
    options?: TtsSynthesisOptions,
  ): Promise<TtsStreamArtifact[]> {
    const artifacts: TtsStreamArtifact[] = [];
    let index = 0;
    for await (const chunk of chunks) {
      const text = chunk.trim();
      if (!text) continue;
      const speech = await this.requestSpeech(text, options);
      artifacts.push(await this.writeAudio(speech, text, index++, options));
    }
    return artifacts;
  }

  private async requestSpeech(
    text: string,
    options?: TtsSynthesisOptions,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const responseFormat = this.responseFormat;
    const response = await fetch(`${this.baseUrl}${withLeadingSlash(this.endpointPath)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: responseFormat === "mp3" ? "audio/mpeg" : `audio/${responseFormat}`,
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(
        buildKokoroSpeechRequest(text, {
          model: options?.model ?? this.model,
          voiceName: options?.voiceName ?? this.voiceName,
          responseFormat,
          speed: options?.speed,
          language: options?.language,
        }),
      ),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Kokoro TTS failed with ${response.status}: ${detail || response.statusText}`);
    }
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || `audio/${responseFormat}`;
    return { buffer: Buffer.from(await response.arrayBuffer()), mimeType };
  }

  private async writeAudio(
    audio: { buffer: Buffer; mimeType: string },
    text: string,
    index: number,
    options?: TtsSynthesisOptions,
  ): Promise<TtsStreamArtifact> {
    const outputDir = path.resolve(options?.outputDir ?? this.outputDir);
    await fs.mkdir(outputDir, { recursive: true });
    const extension = mime.getExtension(audio.mimeType) ?? this.responseFormat;
    const filePrefix = options?.filePrefix ?? "kokoro-tts";
    const filePath = path.join(outputDir, `${filePrefix}-${String(index).padStart(3, "0")}.${extension}`);
    await fs.writeFile(filePath, audio.buffer);
    return { index, path: filePath, mimeType: audio.mimeType, byteLength: audio.buffer.byteLength, text };
  }
}

/**
 * 阿里云 DashScope (Qwen-TTS) 服务提供商
 */
export class DashScopeTtsProvider implements StreamingTtsProvider {
  private readonly baseUrl: string;
  private readonly endpointPath: string;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly voiceName: string;
  private readonly languageType: string;
  private readonly instructions?: string;
  private readonly optimizeInstructions: boolean;
  private readonly outputDir: string;

  constructor(
    options: {
      baseUrl?: string;
      endpointPath?: string;
      apiKey?: string;
      model?: string;
      voiceName?: string;
      languageType?: string;
      instructions?: string;
      optimizeInstructions?: boolean;
      outputDir?: string;
    } = {},
  ) {
    this.baseUrl = (
      options.baseUrl ??
      process.env.DASHSCOPE_BASE_HTTP_API_URL ??
      process.env.DASHSCOPE_BASE_URL ??
      "https://dashscope.aliyuncs.com/api/v1"
    ).replace(/\/+$/, "");
    this.endpointPath =
      options.endpointPath ??
      process.env.DASHSCOPE_TTS_ENDPOINT_PATH ??
      "/services/aigc/multimodal-generation/generation";
    this.apiKey = options.apiKey ?? process.env.DASHSCOPE_API_KEY;
    this.model = options.model ?? process.env.QWEN_TTS_MODEL ?? "qwen3-tts-instruct-flash";
    this.voiceName = options.voiceName ?? process.env.QWEN_TTS_VOICE ?? "Cherry";
    this.languageType = options.languageType ?? process.env.QWEN_TTS_LANGUAGE_TYPE ?? "Chinese";
    this.instructions = options.instructions ?? process.env.QWEN_TTS_INSTRUCTIONS ?? defaultLiveTtsInstructions();
    this.optimizeInstructions = options.optimizeInstructions ?? process.env.QWEN_TTS_OPTIMIZE_INSTRUCTIONS !== "false";
    this.outputDir = options.outputDir ?? "artifacts/tts";
  }

  async synthesizeToFiles(text: string, options?: TtsSynthesisOptions): Promise<TtsStreamArtifact[]> {
    return this.synthesizeTextStream(single(text), options);
  }

  async synthesizeTextStream(
    chunks: AsyncIterable<string>,
    options?: TtsSynthesisOptions,
  ): Promise<TtsStreamArtifact[]> {
    const artifacts: TtsStreamArtifact[] = [];
    let index = 0;
    for await (const chunk of chunks) {
      const text = chunk.trim();
      if (!text) continue;
      const audio = await this.requestSpeech(text, options);
      artifacts.push(
        await writeAudioArtifact(audio, text, index++, {
          outputDir: options?.outputDir ?? this.outputDir,
          filePrefix: options?.filePrefix ?? "qwen-tts",
          fallbackExtension: "wav",
        }),
      );
    }
    return artifacts;
  }

  async requestSpeech(text: string, options?: TtsSynthesisOptions): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!this.apiKey) throw new Error("Missing DASHSCOPE_API_KEY for DashScope Qwen-TTS.");
    const request = buildDashScopeSpeechRequest(text, {
      model: options?.model ?? this.model,
      voiceName: options?.voiceName ?? this.voiceName,
      language: options?.language ?? this.languageType,
      instructions: options?.instructions ?? this.instructions,
      optimizeInstructions: options?.optimizeInstructions ?? this.optimizeInstructions,
      stream: options?.stream,
    });
    const response = await fetchDashScopeAudio(request, {
      baseUrl: this.baseUrl,
      endpointPath: this.endpointPath,
      apiKey: this.apiKey,
    });
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get("content-type")?.split(";")[0]?.trim() || "audio/wav",
    };
  }
}

/**
 * 工厂方法：根据配置创建提供商
 */
export function createConfiguredTtsProvider(): StreamingTtsProvider {
  return getConfiguredTtsProviderName() === "dashscope" ? new DashScopeTtsProvider() : new KokoroTtsProvider();
}

export function getConfiguredTtsProviderName(): TtsProviderName {
  return normalizeTtsProvider(process.env.STELLE_TTS_PROVIDER ?? process.env.LIVE_TTS_PROVIDER ?? "kokoro");
}

export function getConfiguredLiveTtsTransport(): LiveTtsTransport {
  const value = String(process.env.LIVE_TTS_TRANSPORT ?? process.env.QWEN_TTS_TRANSPORT ?? "http_sse")
    .trim()
    .toLowerCase();
  return value === "realtime_ws" || value === "realtime" || value === "websocket" ? "realtime_ws" : "http_sse";
}

export function normalizeTtsProvider(value: string): TtsProviderName {
  const normalized = value.trim().toLowerCase();
  if (normalized === "dashscope" || normalized === "qwen" || normalized === "qwen-tts" || normalized === "aliyun")
    return "dashscope";
  return "kokoro";
}

/**
 * 为直播 Renderer 构建代理请求
 */
export function buildLiveTtsRequest(text: string, options: TtsSynthesisOptions = {}): LiveTtsRequest {
  const provider = getConfiguredTtsProviderName();
  if (provider === "dashscope") {
    return {
      provider,
      request: buildDashScopeSpeechRequest(text, {
        model:
          options.model ?? process.env.QWEN_TTS_LIVE_MODEL ?? process.env.QWEN_TTS_MODEL ?? "qwen3-tts-instruct-flash",
        voiceName: options.voiceName ?? process.env.QWEN_TTS_VOICE ?? "Cherry",
        language: options.language ?? process.env.QWEN_TTS_LANGUAGE_TYPE ?? "Chinese",
        instructions: options.instructions ?? process.env.QWEN_TTS_INSTRUCTIONS ?? defaultLiveTtsInstructions(),
        optimizeInstructions: options.optimizeInstructions ?? process.env.QWEN_TTS_OPTIMIZE_INSTRUCTIONS !== "false",
        stream: options.stream ?? process.env.QWEN_TTS_STREAMING === "true",
      }),
    };
  }

  return {
    provider,
    request: buildKokoroSpeechRequest(text, {
      model: options.model ?? process.env.KOKORO_TTS_MODEL ?? "kokoro",
      voiceName: options.voiceName ?? process.env.KOKORO_TTS_VOICE ?? "zf_xiaobei",
      responseFormat: process.env.KOKORO_TTS_STREAM_RESPONSE_FORMAT ?? process.env.KOKORO_TTS_RESPONSE_FORMAT ?? "wav",
      speed: options.speed,
      language: options.language ?? process.env.KOKORO_TTS_LANGUAGE,
    }),
  };
}

/**
 * 拉取直播 TTS 音频
 */
export async function fetchLiveTtsAudio(provider: string, request: Record<string, unknown>): Promise<Response> {
  const normalized = normalizeTtsProvider(provider);
  const cacheKey = `${normalized}:${JSON.stringify(request)}`;
  const cached = liveTtsCache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < liveTtsCacheTtlMs()) {
    return new Response(toExactArrayBuffer(cached.bytes), { headers: { "content-type": cached.mimeType } });
  }

  if (normalized === "dashscope") {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) throw new Error("Missing DASHSCOPE_API_KEY for DashScope Qwen-TTS.");
    return cacheResponse(cacheKey, await fetchDashScopeAudio(request, { apiKey }));
  }
  return cacheResponse(cacheKey, await fetchKokoroAudio(request));
}

// === Helpers ===

const liveTtsCache = new Map<string, { bytes: Uint8Array; mimeType: string; createdAt: number }>();

export function buildKokoroSpeechRequest(
  text: string,
  options: {
    model: string;
    voiceName: string;
    responseFormat: string;
    speed?: number;
    language?: string;
  },
): Record<string, unknown> {
  return {
    model: options.model,
    input: text,
    voice: options.voiceName,
    response_format: options.responseFormat,
    ...(typeof options.speed === "number" ? { speed: options.speed } : {}),
    ...(options.language ? { language: options.language } : {}),
  };
}

export function buildDashScopeSpeechRequest(
  text: string,
  options: {
    model: string;
    voiceName: string;
    language: string;
    instructions?: string;
    optimizeInstructions?: boolean;
    stream?: boolean;
  },
): Record<string, unknown> {
  const instructModel = options.model.includes("instruct");
  return {
    model: options.model,
    input: {
      text,
      voice: options.voiceName,
      language_type: options.language,
      ...(instructModel && options.instructions ? { instructions: options.instructions } : {}),
      ...(instructModel && typeof options.optimizeInstructions === "boolean"
        ? { optimize_instructions: options.optimizeInstructions }
        : {}),
    },
    ...(options.stream ? { parameters: { stream: true } } : {}),
  };
}

async function fetchKokoroAudio(request: Record<string, unknown>): Promise<Response> {
  const baseUrl = (process.env.KOKORO_TTS_BASE_URL ?? "http://127.0.0.1:8880").replace(/\/+$/, "");
  const endpointPath = process.env.KOKORO_TTS_ENDPOINT_PATH ?? "/v1/audio/speech";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.KOKORO_TTS_API_KEY) headers.authorization = `Bearer ${process.env.KOKORO_TTS_API_KEY}`;

  const response = await fetch(`${baseUrl}${withLeadingSlash(endpointPath)}`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(liveTtsTimeoutMs()),
  });

  if (!response.ok) throw new Error(`Kokoro TTS failed: ${response.status} ${response.statusText}`);
  return response;
}

async function fetchDashScopeAudio(
  request: Record<string, unknown>,
  options: { baseUrl?: string; endpointPath?: string; apiKey: string },
): Promise<Response> {
  const baseUrl = (
    options.baseUrl ??
    process.env.DASHSCOPE_BASE_HTTP_API_URL ??
    process.env.DASHSCOPE_BASE_URL ??
    "https://dashscope.aliyuncs.com/api/v1"
  ).replace(/\/+$/, "");
  const endpointPath =
    options.endpointPath ??
    process.env.DASHSCOPE_TTS_ENDPOINT_PATH ??
    "/services/aigc/multimodal-generation/generation";
  const stream = Boolean((request.parameters as Record<string, unknown> | undefined)?.stream);

  const response = await fetch(`${baseUrl}${withLeadingSlash(endpointPath)}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
      ...(stream ? { "X-DashScope-SSE": "enable" } : {}),
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(liveTtsTimeoutMs()),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`DashScope Qwen-TTS failed with ${response.status}: ${detail || response.statusText}`);
  }

  if (stream) {
    const text = await response.text();
    const pcm = parseDashScopeSsePcm(text);
    if (!pcm.byteLength) throw new Error("DashScope Qwen-TTS stream returned no audio data.");
    const wav = toWav(pcm, Number(process.env.QWEN_TTS_SAMPLE_RATE ?? 24000));
    return new Response(toExactArrayBuffer(wav), {
      headers: { "content-type": "audio/wav" },
    });
  }

  const payload = (await response.json()) as Record<string, any>;
  const audio = payload?.output?.audio;
  const audioUrl = typeof audio?.url === "string" ? audio.url : undefined;

  if (audioUrl) {
    const audioResponse = await fetch(audioUrl, { signal: AbortSignal.timeout(liveTtsTimeoutMs()) });
    if (!audioResponse.ok)
      throw new Error(`DashScope audio download failed: ${audioResponse.status} ${audioResponse.statusText}`);
    return audioResponse;
  }

  if (typeof audio?.data === "string") {
    const data = Buffer.from(audio.data, "base64");
    return new Response(toExactArrayBuffer(data), {
      headers: { "content-type": "audio/wav" },
    });
  }

  throw new Error("DashScope Qwen-TTS response did not include output.audio.url or output.audio.data.");
}

async function cacheResponse(cacheKey: string, response: Response): Promise<Response> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "audio/wav";

  liveTtsCache.set(cacheKey, { bytes, mimeType, createdAt: Date.now() });
  while (liveTtsCache.size > liveTtsCacheMaxEntries()) {
    const oldest = liveTtsCache.keys().next().value;
    if (!oldest) break;
    liveTtsCache.delete(oldest);
  }

  return new Response(toExactArrayBuffer(bytes), { status: response.status, headers: { "content-type": mimeType } });
}

function liveTtsTimeoutMs(): number {
  const value = Number(process.env.LIVE_TTS_TIMEOUT_MS ?? 15_000);
  return Number.isFinite(value) ? Math.max(1000, value) : 15_000;
}

function liveTtsCacheTtlMs(): number {
  const value = Number(process.env.LIVE_TTS_CACHE_TTL_MS ?? 10 * 60_000);
  return Number.isFinite(value) ? Math.max(0, value) : 10 * 60_000;
}

function liveTtsCacheMaxEntries(): number {
  const value = Number(process.env.LIVE_TTS_CACHE_MAX_ENTRIES ?? 80);
  return Number.isFinite(value) ? Math.max(0, value) : 80;
}

function parseDashScopeSsePcm(text: string): Buffer {
  const chunks: Buffer[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const payload = JSON.parse(data) as Record<string, any>;
      const audioData = payload?.output?.audio?.data;
      if (typeof audioData === "string" && audioData) chunks.push(Buffer.from(audioData, "base64"));
    } catch {
      // Ignore keepalive or malformed SSE lines
    }
  }
  return Buffer.concat(chunks);
}

export function parseDashScopeRealtimeAudioDelta(event: Record<string, any>): string | undefined {
  const delta = event.delta ?? event.output?.audio?.data;
  return typeof delta === "string" && delta.trim() ? delta.trim() : undefined;
}

function realtimeEventId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function toWav(pcm16: Buffer, sampleRate: number): Uint8Array {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm16.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm16.byteLength, 40);
  return Buffer.concat([header, pcm16]);
}

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function writeAudioArtifact(
  audio: { buffer: Buffer; mimeType: string },
  text: string,
  index: number,
  options: {
    outputDir: string;
    filePrefix: string;
    fallbackExtension: string;
  },
): Promise<TtsStreamArtifact> {
  const outputDir = path.resolve(options.outputDir);
  await fs.mkdir(outputDir, { recursive: true });
  const extension = mime.getExtension(audio.mimeType) ?? options.fallbackExtension;
  const filePath = path.join(outputDir, `${options.filePrefix}-${String(index).padStart(3, "0")}.${extension}`);
  await fs.writeFile(filePath, audio.buffer);
  return { index, path: filePath, mimeType: audio.mimeType, byteLength: audio.buffer.byteLength, text };
}

function defaultLiveTtsInstructions(): string {
  return "语气活泼、亲切，像虚拟主播直播间即时回应。语速中等偏快，句尾自然，避免夸张播音腔。";
}

function withLeadingSlash(value: string): string {
  return value.startsWith("/") ? value : `/${value}`;
}

async function* single(text: string): AsyncIterable<string> {
  yield text;
}
