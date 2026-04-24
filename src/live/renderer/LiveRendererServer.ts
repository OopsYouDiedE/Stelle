import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import type { Live2DStageState, LiveRendererAudioStatus, LiveRendererBridge, LiveRendererCommand } from "../types.js";
import { renderDebugHtml } from "./renderDebugHtml.js";
import { renderLiveHtml } from "./renderLiveHtml.js";
import {
  asRecord,
  clampMockInterval,
  cloneState,
  contentType,
  parseJson,
  readBody,
  normalizeMockSpeechChunks,
  type MockSpeechRequest,
} from "./serverUtils.js";

export interface LiveRendererServerOptions {
  host?: string;
  port?: number;
  initialState?: Live2DStageState;
  debugController?: LiveRendererDebugController;
}

export interface LiveRendererDebugController {
  getSnapshot(): Promise<Record<string, unknown>>;
  switchCursor(cursorId: string, reason: string): Promise<void>;
  observeCursor(cursorId?: string): Promise<unknown>;
  useTool(
    name: string,
    input: Record<string, unknown>,
    options?: { cursorId?: string; returnToInner?: boolean }
  ): Promise<unknown>;
  sendDiscordMessage(input: {
    channel_id: string;
    content: string;
    mention_user_ids?: string[];
    reply_to_message_id?: string;
  }): Promise<unknown>;
  getDiscordHistory(channelId?: string): Promise<unknown> | unknown;
}

const DEFAULT_BACKGROUND =
  "radial-gradient(circle at 50% 35%, rgba(255,255,255,.26), transparent 0 18%, transparent 18%), linear-gradient(135deg, #243b53 0%, #1f6f78 48%, #284b63 100%)";

export class LiveRendererServer implements LiveRendererBridge {
  private readonly events = new EventEmitter();
  private readonly server: http.Server;
  private readonly audioStreams = new Map<string, Extract<LiveRendererCommand, { type: "audio:stream" }>>();
  private debugController?: LiveRendererDebugController;
  private state: Live2DStageState;
  private audioStatus: LiveRendererAudioStatus = {
    queued: 0,
    playing: false,
    playedCount: 0,
    activated: true,
    updatedAt: Date.now(),
    lastEvent: "server_started",
  };

  constructor(private readonly options: LiveRendererServerOptions = {}) {
    this.debugController = options.debugController;
    this.state = options.initialState ?? {
      visible: true,
      background: DEFAULT_BACKGROUND,
      caption: "Stelle Live Renderer ready.",
    };
    this.server = http.createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
        response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      });
    });
  }

  async start(): Promise<string> {
    if (this.server.listening) return this.url;
    await new Promise<void>((resolve) => {
      this.server.listen(this.options.port ?? 8787, this.options.host ?? "127.0.0.1", resolve);
    });
    return this.url;
  }

  async stop(): Promise<void> {
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  get url(): string {
    const address = this.server.address() as AddressInfo | null;
    const host = this.options.host ?? "127.0.0.1";
    return `http://${host}:${address?.port ?? this.options.port ?? 8787}`;
  }

  get liveUrl(): string {
    return `${this.url}/live`;
  }

  get debugUrl(): string {
    return `${this.url}/_debug`;
  }

  setDebugController(controller?: LiveRendererDebugController): void {
    this.debugController = controller;
  }

  getState(): Live2DStageState {
    return cloneState(this.state);
  }

  getAudioStatus(): LiveRendererAudioStatus {
    return { ...this.audioStatus };
  }

  publish(command: LiveRendererCommand): void {
    this.apply(command);
    this.events.emit("command", command);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", this.url);
    if (request.method === "GET" && url.pathname === "/_debug") {
      this.serveDebugPage(response);
      return;
    }
    if (url.pathname.startsWith("/_debug/api/")) {
      await this.handleDebugApi(request, response, url);
      return;
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/live")) {
      await this.serveRendererIndex(response);
      return;
    }
    if (
      request.method === "GET" &&
      (url.pathname.startsWith("/assets/") ||
        url.pathname.startsWith("/Core/") ||
        url.pathname.startsWith("/Resources/") ||
        url.pathname.startsWith("/artifacts/"))
    ) {
      await this.serveStatic(url.pathname, response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/events") {
      this.handleEvents(response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/state") {
      this.writeJson(response, 200, { ok: true, state: this.state, audio: this.audioStatus });
      return;
    }
    if (request.method === "GET" && url.pathname === "/audio-status") {
      this.writeJson(response, 200, { ok: true, audio: this.audioStatus });
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/tts/kokoro/")) {
      await this.serveKokoroStream(url.pathname, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/audio-status") {
      this.updateAudioStatus(parseJson(await readBody(request)) as Partial<LiveRendererAudioStatus>);
      this.writeJson(response, 200, { ok: true, audio: this.audioStatus });
      return;
    }
    if (request.method === "POST" && url.pathname === "/command") {
      const command = parseJson(await readBody(request)) as LiveRendererCommand;
      this.publish(command);
      this.writeJson(response, 200, { ok: true, state: this.state });
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }

  private async handleDebugApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const body = request.method === "POST" ? (parseJson(await readBody(request)) as Record<string, unknown>) : {};
    if (request.method === "POST" && url.pathname === "/_debug/api/mock-speech") {
      try {
        const report = this.enqueueMockSpeech(body as MockSpeechRequest);
        this.writeJson(response, 200, { ok: true, report });
      } catch (error) {
        this.writeJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (!this.debugController) {
      this.writeJson(response, 503, { ok: false, error: "debug controller unavailable" });
      return;
    }
    try {
      if (request.method === "GET" && url.pathname === "/_debug/api/snapshot") {
        this.writeJson(response, 200, { ok: true, snapshot: await this.debugController.getSnapshot() });
        return;
      }
      if (request.method === "GET" && url.pathname === "/_debug/api/discord-history") {
        this.writeJson(response, 200, {
          ok: true,
          history: await this.debugController.getDiscordHistory(url.searchParams.get("channelId") ?? undefined),
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/_debug/api/switch-cursor") {
        await this.debugController.switchCursor(String(body.cursorId ?? ""), String(body.reason ?? "debug panel switch cursor"));
        this.writeJson(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/_debug/api/observe") {
        this.writeJson(response, 200, {
          ok: true,
          observation: await this.debugController.observeCursor(typeof body.cursorId === "string" ? body.cursorId : undefined),
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/_debug/api/use-tool") {
        this.writeJson(response, 200, {
          ok: true,
          result: await this.debugController.useTool(String(body.name ?? ""), asRecord(body.input), {
            cursorId: typeof body.cursorId === "string" ? body.cursorId : undefined,
            returnToInner: body.returnToInner === true,
          }),
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/_debug/api/send-discord-message") {
        this.writeJson(response, 200, {
          ok: true,
          result: await this.debugController.sendDiscordMessage({
            channel_id: String(body.channel_id ?? ""),
            content: String(body.content ?? ""),
            mention_user_ids: Array.isArray(body.mention_user_ids) ? body.mention_user_ids.map(String) : undefined,
            reply_to_message_id: typeof body.reply_to_message_id === "string" ? body.reply_to_message_id : undefined,
          }),
        });
        return;
      }
      this.writeJson(response, 404, { ok: false, error: "debug api not found" });
    } catch (error) {
      this.writeJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private handleEvents(response: ServerResponse): void {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    response.write(`event: command\ndata: ${JSON.stringify({ type: "state:set", state: this.state })}\n\n`);
    const listener = (command: LiveRendererCommand) => {
      response.write(`event: command\ndata: ${JSON.stringify(command)}\n\n`);
    };
    this.events.on("command", listener);
    response.on("close", () => this.events.off("command", listener));
  }

  private apply(command: LiveRendererCommand): void {
    if (command.type === "state:set") this.state = cloneState(command.state);
    if (command.type === "caption:set") this.state = { ...this.state, caption: command.text };
    if (command.type === "caption:clear") this.state = { ...this.state, caption: undefined };
    if (command.type === "background:set") this.state = { ...this.state, background: command.source };
    if (command.type === "model:load") this.state = { ...this.state, model: command.model ?? this.state.model };
    if (command.type === "audio:play" || command.type === "audio:stream") {
      this.updateAudioStatus({
        queued: this.audioStatus.queued + 1,
        playing: this.audioStatus.playing,
        playedCount: this.audioStatus.playedCount,
        lastEvent: "command_queued",
        lastUrl: command.url,
        lastText: command.text,
        lastError: undefined,
        errorName: undefined,
        mediaErrorCode: undefined,
        mediaErrorMessage: undefined,
      });
    }
    if (command.type === "motion:trigger") {
      this.state = {
        ...this.state,
        lastMotion: { group: command.group, priority: command.priority, triggeredAt: Date.now() },
      };
    }
    if (command.type === "expression:set") this.state = { ...this.state, expression: command.expression };
    if (command.type === "audio:stream") this.audioStreams.set(command.url.split("/").pop() ?? command.url, command);
    if (
      command.type === "mouth:set" ||
      command.type === "speech:start" ||
      command.type === "speech:stop" ||
      command.type === "audio:play" ||
      command.type === "audio:stream"
    ) {
      this.state = { ...this.state };
    }
  }

  private updateAudioStatus(status: Partial<LiveRendererAudioStatus>): void {
    this.audioStatus = {
      ...this.audioStatus,
      ...status,
      updatedAt: Date.now(),
    };
    if (status.lastError) {
      console.warn(
        `[Stelle] Live renderer audio ${status.lastEvent ?? "error"}: ${status.errorName ? `${status.errorName}: ` : ""}${status.lastError}`
      );
    }
  }

  private async serveRendererIndex(response: ServerResponse): Promise<void> {
    const indexPath = path.resolve("dist/live-renderer/index.html");
    try {
      const html = await fs.readFile(indexPath, "utf8");
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
    } catch {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(renderLiveHtml(this.state, DEFAULT_BACKGROUND));
    }
  }

  private async serveStatic(pathname: string, response: ServerResponse): Promise<void> {
    const root = pathname.startsWith("/assets/")
      ? path.resolve("dist/live-renderer")
      : pathname.startsWith("/artifacts/")
        ? path.resolve("artifacts")
        : path.resolve(process.env.LIVE2D_PUBLIC_ROOT ?? "assets/live2d/public");
    const relativePath = pathname.startsWith("/artifacts/")
      ? pathname.slice("/artifacts/".length)
      : "." + decodeURIComponent(pathname);
    const target = path.resolve(root, relativePath);
    if (target !== root && !target.startsWith(root + path.sep)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    try {
      const content = await fs.readFile(target);
      response.writeHead(200, { "content-type": contentType(target), "cache-control": "public, max-age=3600" });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  }

  private serveDebugPage(response: ServerResponse): void {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(renderDebugHtml(this.liveUrl));
  }

  private async serveKokoroStream(pathname: string, response: ServerResponse): Promise<void> {
    const id = decodeURIComponent(pathname.split("/").pop() ?? "");
    const command = this.audioStreams.get(id);
    if (!command) {
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: "unknown Kokoro stream id" }));
      return;
    }
    const baseUrl = (process.env.KOKORO_TTS_BASE_URL ?? "http://127.0.0.1:8880").replace(/\/+$/, "");
    const endpointPath = process.env.KOKORO_TTS_ENDPOINT_PATH ?? "/v1/audio/speech";
    const apiKey = process.env.KOKORO_TTS_API_KEY;
    const upstream = await fetch(`${baseUrl}${endpointPath.startsWith("/") ? "" : "/"}${endpointPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: command.request.response_format === "mp3" ? "audio/mpeg" : `audio/${command.request.response_format ?? "wav"}`,
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ ...command.request, stream: true }),
    });
    if (!upstream.ok) {
      response.writeHead(upstream.status, { "content-type": "text/plain; charset=utf-8" });
      response.end(await upstream.text().catch(() => upstream.statusText));
      return;
    }
    response.writeHead(200, {
      "content-type": upstream.headers.get("content-type") ?? "audio/wav",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    if (!upstream.body) {
      response.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.byteLength) response.write(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
      response.end();
      this.audioStreams.delete(id);
    }
  }

  private writeJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
  }

  private enqueueMockSpeech(input: MockSpeechRequest): {
    chunkCount: number;
    intervalMs: number;
    voiceName: string;
    language?: string;
    chunks: string[];
  } {
    const chunks = normalizeMockSpeechChunks(input);
    if (!chunks.length) {
      throw new Error("mock speech requires at least one non-empty chunk");
    }
    const intervalMs = clampMockInterval(input.intervalMs);
    const voiceName = typeof input.voice_name === "string" && input.voice_name.trim() ? input.voice_name.trim() : process.env.KOKORO_TTS_VOICE ?? "zf_xiaobei";
    const language = typeof input.language === "string" && input.language.trim()
      ? input.language.trim()
      : voiceName.startsWith("z")
        ? process.env.KOKORO_TTS_LANGUAGE ?? "z"
        : undefined;
    const speed = typeof input.speed === "number" && Number.isFinite(input.speed) ? input.speed : undefined;

    let caption = "";
    chunks.forEach((chunk, index) => {
      const run = () => {
        caption += chunk;
        this.publish({ type: "caption:set", text: caption });
        const id = `mock-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
        const request: Record<string, string | number | boolean> = {
          model: process.env.KOKORO_TTS_MODEL ?? "kokoro",
          input: chunk,
          voice: voiceName,
          response_format: process.env.KOKORO_TTS_STREAM_RESPONSE_FORMAT ?? process.env.KOKORO_TTS_RESPONSE_FORMAT ?? "wav",
          stream: true,
          ...(language ? { language } : {}),
          ...(typeof speed === "number" ? { speed } : {}),
        };
        this.publish({
          type: "audio:stream",
          url: `/tts/kokoro/${id}`,
          text: chunk,
          provider: "kokoro",
          request,
        });
      };
      if (index === 0) {
        run();
        return;
      }
      setTimeout(run, intervalMs * index);
    });

    return {
      chunkCount: chunks.length,
      intervalMs,
      voiceName,
      ...(language ? { language } : {}),
      chunks,
    };
  }
}
