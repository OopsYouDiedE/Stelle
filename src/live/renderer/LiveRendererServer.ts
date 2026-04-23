import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import type { Live2DStageState, LiveRendererAudioStatus, LiveRendererBridge, LiveRendererCommand } from "../types.js";

export interface LiveRendererServerOptions {
  host?: string;
  port?: number;
  initialState?: Live2DStageState;
}

const DEFAULT_BACKGROUND =
  "radial-gradient(circle at 50% 35%, rgba(255,255,255,.26), transparent 0 18%, transparent 18%), linear-gradient(135deg, #243b53 0%, #1f6f78 48%, #284b63 100%)";

export class LiveRendererServer implements LiveRendererBridge {
  private readonly events = new EventEmitter();
  private readonly server: http.Server;
  private readonly audioStreams = new Map<string, Extract<LiveRendererCommand, { type: "audio:stream" }>>();
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

  getState(): Live2DStageState {
    return cloneState(this.state);
  }

  getAudioStatus(): LiveRendererAudioStatus {
    return { ...this.audioStatus };
  }

  publish(command: LiveRendererCommand): void {
    this.apply(command);
    this.events.emit("command", commandForRendererClient(command));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", this.url);
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
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, state: this.state, audio: this.audioStatus }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/audio-status") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, audio: this.audioStatus }));
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/tts/kokoro/")) {
      await this.serveKokoroStream(url.pathname, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/audio-status") {
      this.updateAudioStatus(JSON.parse(await readBody(request)) as Partial<LiveRendererAudioStatus>);
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, audio: this.audioStatus }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/command") {
      const command = JSON.parse(await readBody(request)) as LiveRendererCommand;
      this.publish(command);
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, state: this.state }));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
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
      response.end(renderHtml(this.state));
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
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".moc3") return "application/octet-stream";
  if (ext === ".wasm") return "application/wasm";
  return "application/octet-stream";
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function cloneState(state: Live2DStageState): Live2DStageState {
  return JSON.parse(JSON.stringify(state)) as Live2DStageState;
}

function commandForRendererClient(command: LiveRendererCommand): LiveRendererCommand {
  return command;
}

function renderHtml(initialState: Live2DStageState): string {
  const stateJson = JSON.stringify(initialState).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stelle Live</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, "Microsoft YaHei", "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #101923; }
    #stage { position: relative; width: 100vw; height: 100vh; background: var(--bg); background-size: cover; background-position: center; }
    #stage::before { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.05), rgba(0,0,0,.32)); }
    #model { position: absolute; left: 50%; top: 48%; width: min(54vw, 660px); height: min(82vh, 900px); transform: translate(-50%, -50%); display: grid; place-items: center; }
    #model-card { width: 100%; height: 100%; position: relative; display: grid; place-items: center; filter: drop-shadow(0 30px 45px rgba(0,0,0,.32)); animation: breathe 4s ease-in-out infinite; }
    #model-standin { width: min(78%, 430px); aspect-ratio: 0.58; border-radius: 50% 50% 42% 42% / 34% 34% 46% 46%; background: linear-gradient(165deg, #f8fbff 0 18%, #8bd5d1 18% 34%, #355c7d 34% 100%); box-shadow: inset 0 0 0 10px rgba(255,255,255,.28), 0 20px 60px rgba(0,0,0,.28); }
    #model-name { position: absolute; top: 9%; padding: 8px 18px; border: 1px solid rgba(255,255,255,.34); border-radius: 999px; background: rgba(11,24,38,.42); backdrop-filter: blur(10px); color: white; font-size: 22px; }
    #caption { position: absolute; left: 50%; bottom: 46px; width: min(88vw, 1500px); min-height: 132px; transform: translateX(-50%); display: grid; place-items: center; padding: 24px 44px; color: white; font-size: 48px; line-height: 1.28; text-align: center; text-shadow: 0 3px 12px rgba(0,0,0,.72); background: rgba(7, 15, 23, .68); border: 1px solid rgba(255,255,255,.18); border-radius: 8px; backdrop-filter: blur(14px); overflow: hidden; }
    #voice { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
    #caption-text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
    @keyframes breathe { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-1.4%) scale(1.012); } }
    @media (max-width: 900px) {
      #model { width: 74vw; height: 72vh; top: 44%; }
      #caption { bottom: 24px; width: 92vw; min-height: 104px; padding: 18px 24px; font-size: 28px; }
      #model-name { font-size: 16px; }
    }
  </style>
</head>
<body>
  <main id="stage">
    <section id="model" aria-label="Live2D model">
      <div id="model-card">
        <div id="model-name"></div>
        <div id="model-standin"></div>
      </div>
    </section>
    <section id="caption" aria-live="polite"><div id="caption-text"></div></section>
    <audio id="voice" crossorigin="anonymous" autoplay></audio>
  </main>
  <script>
    const state = ${stateJson};
    const stage = document.getElementById("stage");
    const caption = document.getElementById("caption-text");
    const modelName = document.getElementById("model-name");
    const voice = document.getElementById("voice");
    const silentWavDataUrl = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
    const audioQueue = [];
    let audioPlaying = false;
    let primingAudio = false;
    let retryTimer;
    function updateAudioState(patch) {
      window.__stelleAudioState = Object.assign({
        queued: audioQueue.length,
        playing: audioPlaying,
        playedCount: (window.__stelleAudioState && window.__stelleAudioState.playedCount) || 0,
        activated: true,
        lastUrl: window.__stelleAudioState && window.__stelleAudioState.lastUrl,
        lastText: window.__stelleAudioState && window.__stelleAudioState.lastText,
        lastEvent: window.__stelleAudioState && window.__stelleAudioState.lastEvent,
        lastError: window.__stelleAudioState && window.__stelleAudioState.lastError,
        errorName: window.__stelleAudioState && window.__stelleAudioState.errorName,
        mediaErrorCode: window.__stelleAudioState && window.__stelleAudioState.mediaErrorCode,
        mediaErrorMessage: window.__stelleAudioState && window.__stelleAudioState.mediaErrorMessage
      }, patch || {});
      try { fetch("/audio-status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(window.__stelleAudioState), keepalive: true }); } catch {}
    }
    function applyState(next) {
      Object.assign(state, next);
      stage.style.setProperty("--bg", state.background || "${DEFAULT_BACKGROUND}");
      if (state.background && /^(https?:|data:|file:|\\/)/.test(state.background)) {
        stage.style.backgroundImage = "url('" + state.background.replace(/'/g, "%27") + "')";
      } else {
        stage.style.backgroundImage = state.background || "${DEFAULT_BACKGROUND}";
      }
      caption.textContent = state.caption || "";
      modelName.textContent = state.model?.displayName || state.model?.id || "Hiyori Pro";
    }
    function applyCommand(command) {
      if (command.type === "state:set") applyState(command.state || {});
      if (command.type === "caption:set") applyState({ caption: command.text || "" });
      if (command.type === "caption:clear") applyState({ caption: "" });
      if (command.type === "background:set") applyState({ background: command.source || "" });
      if (command.type === "model:load") applyState({ model: command.model || state.model });
      if (command.type === "motion:trigger") {
        const card = document.getElementById("model-card");
        card.animate([{ transform: "translateY(0) scale(1)" }, { transform: "translateY(-3%) scale(1.035)" }, { transform: "translateY(0) scale(1)" }], { duration: 520, easing: "ease-out" });
      }
      if (command.type === "audio:play" || command.type === "audio:stream") {
        audioQueue.push(command);
        updateAudioState({ queued: audioQueue.length, lastEvent: "queued", lastUrl: command.url, lastText: command.text, lastError: undefined, errorName: undefined, mediaErrorCode: undefined, mediaErrorMessage: undefined });
        void playNextAudio();
      }
    }
    async function playNextAudio() {
      if (audioPlaying || !audioQueue.length) return;
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      audioPlaying = true;
      const next = audioQueue[0];
      if (next.text) applyState({ caption: next.text });
      primingAudio = false;
      voice.loop = false;
      voice.muted = false;
      voice.src = next.url;
      updateAudioState({ queued: audioQueue.length, playing: true, lastEvent: "play_requested", lastUrl: next.url, lastText: next.text, lastError: undefined, errorName: undefined, mediaErrorCode: undefined, mediaErrorMessage: undefined });
      try { await voice.play(); audioQueue.shift(); updateAudioState({ queued: audioQueue.length, playing: true, lastEvent: "play_resolved", lastError: undefined, errorName: undefined, mediaErrorCode: undefined, mediaErrorMessage: undefined }); } catch (error) { audioPlaying = false; const message = error instanceof Error ? error.message : String(error); const errorName = error instanceof Error ? error.name : undefined; const mediaError = describeMediaError(); updateAudioState(Object.assign({ playing: false, activated: true, lastEvent: "play_rejected", lastError: message, errorName }, mediaError)); scheduleAudioRetry(); }
    }
    async function primeAudioElement() {
      primingAudio = true;
      voice.muted = true;
      voice.loop = true;
      voice.src = silentWavDataUrl;
      updateAudioState({ playing: false, activated: true, lastEvent: "priming_requested", lastError: undefined, errorName: undefined, mediaErrorCode: undefined, mediaErrorMessage: undefined });
      try { await voice.play(); updateAudioState({ playing: false, activated: true, lastEvent: "primed", lastError: undefined, errorName: undefined, mediaErrorCode: undefined, mediaErrorMessage: undefined }); } catch (error) { primingAudio = false; updateAudioState(Object.assign({ playing: false, activated: true, lastEvent: "priming_blocked", lastError: "audio priming blocked: " + (error instanceof Error ? error.message : String(error)), errorName: error instanceof Error ? error.name : undefined }, describeMediaError())); }
    }
    function describeMediaError() {
      return {
        mediaErrorCode: voice.error && voice.error.code || undefined,
        mediaErrorMessage: voice.error && voice.error.message || undefined
      };
    }
    function scheduleAudioRetry() {
      if (retryTimer !== undefined || !audioQueue.length) return;
      retryTimer = setTimeout(() => { retryTimer = undefined; void playNextAudio(); }, 2500);
    }
    voice.addEventListener("play", () => { if (primingAudio) return; updateAudioState({ playing: true, lastEvent: "play", lastError: undefined }); applyCommand({ type: "speech:start", durationMs: Math.max(1400, Math.min(20000, Math.round((voice.duration || 3) * 1000))) }); });
    voice.addEventListener("ended", () => { if (primingAudio) return; audioPlaying = false; updateAudioState({ playing: false, lastEvent: "ended", playedCount: ((window.__stelleAudioState && window.__stelleAudioState.playedCount) || 0) + 1 }); applyCommand({ type: "speech:stop" }); void playNextAudio(); });
    voice.addEventListener("error", () => { const mediaError = describeMediaError(); if (primingAudio) { primingAudio = false; updateAudioState(Object.assign({ lastEvent: "priming_error", lastError: "audio priming failed" }, mediaError)); return; } audioPlaying = false; audioQueue.shift(); updateAudioState(Object.assign({ playing: false, queued: audioQueue.length, lastEvent: "error", lastError: "audio element error" }, mediaError)); void playNextAudio(); });
    voice.autoplay = true;
    updateAudioState({ lastEvent: "priming_requested", activated: true });
    void primeAudioElement();
    applyState(state);
    const events = new EventSource("/events");
    events.onopen = () => { window.__stelleRendererEventsReady = true; };
    events.addEventListener("command", event => applyCommand(JSON.parse(event.data)));
  </script>
</body>
</html>`;
}
