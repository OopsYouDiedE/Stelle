import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import type { Live2DStageState, LiveRendererBridge, LiveRendererCommand } from "../types.js";

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
  private state: Live2DStageState;

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

  publish(command: LiveRendererCommand): void {
    this.apply(command);
    this.events.emit("command", command);
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
      response.end(JSON.stringify({ ok: true, state: this.state }));
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
    if (command.type === "motion:trigger") {
      this.state = {
        ...this.state,
        lastMotion: { group: command.group, priority: command.priority, triggeredAt: Date.now() },
      };
    }
    if (command.type === "expression:set") this.state = { ...this.state, expression: command.expression };
    if (command.type === "mouth:set" || command.type === "speech:start" || command.type === "speech:stop" || command.type === "audio:play") {
      this.state = { ...this.state };
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
        : path.resolve("ai-live2d-go/public");
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
        lastUrl: window.__stelleAudioState && window.__stelleAudioState.lastUrl,
        lastText: window.__stelleAudioState && window.__stelleAudioState.lastText,
        lastError: window.__stelleAudioState && window.__stelleAudioState.lastError
      }, patch || {});
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
      if (command.type === "audio:play") {
        audioQueue.push(command);
        updateAudioState({ queued: audioQueue.length, lastUrl: command.url, lastText: command.text, lastError: undefined });
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
      updateAudioState({ queued: audioQueue.length, playing: true, lastUrl: next.url, lastText: next.text, lastError: undefined });
      try { await voice.play(); audioQueue.shift(); updateAudioState({ queued: audioQueue.length, playing: true, lastError: undefined }); } catch (error) { console.warn("Live audio play failed", error); audioPlaying = false; updateAudioState({ playing: false, lastError: error instanceof Error ? error.message : String(error) }); scheduleAudioRetry(); }
    }
    async function primeAudioElement() {
      primingAudio = true;
      voice.muted = true;
      voice.loop = true;
      voice.src = silentWavDataUrl;
      try { await voice.play(); updateAudioState({ lastError: undefined }); } catch (error) { primingAudio = false; updateAudioState({ lastError: "audio priming blocked: " + (error instanceof Error ? error.message : String(error)) }); }
    }
    function scheduleAudioRetry() {
      if (retryTimer !== undefined || !audioQueue.length) return;
      retryTimer = setTimeout(() => { retryTimer = undefined; void playNextAudio(); }, 2500);
    }
    voice.addEventListener("play", () => { if (primingAudio) return; updateAudioState({ playing: true, lastError: undefined }); applyCommand({ type: "speech:start", durationMs: Math.max(1400, Math.min(20000, Math.round((voice.duration || 3) * 1000))) }); });
    voice.addEventListener("ended", () => { if (primingAudio) return; audioPlaying = false; updateAudioState({ playing: false, playedCount: ((window.__stelleAudioState && window.__stelleAudioState.playedCount) || 0) + 1 }); applyCommand({ type: "speech:stop" }); void playNextAudio(); });
    voice.addEventListener("error", () => { if (primingAudio) { primingAudio = false; updateAudioState({ lastError: "audio priming failed" }); return; } audioPlaying = false; audioQueue.shift(); updateAudioState({ playing: false, queued: audioQueue.length, lastError: "audio element error" }); void playNextAudio(); });
    voice.autoplay = true;
    updateAudioState({});
    void primeAudioElement();
    applyState(state);
    const events = new EventSource("/events");
    events.onopen = () => { window.__stelleRendererEventsReady = true; };
    events.addEventListener("command", event => applyCommand(JSON.parse(event.data)));
  </script>
</body>
</html>`;
}
