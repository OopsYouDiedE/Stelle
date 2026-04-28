/**
 * 模块：Live renderer HTTP/SSE 服务 (Express + Socket.io)
 *
 * 运行逻辑：
 * - 提供 `/live` 页面、`/assets/*` 静态资源和 `/samples/*` 测试样本。
 * - 提供 Socket.io 实时通信，把 LiveRuntime 发布的舞台命令推到浏览器。
 * - 提供 debug API，读取 runtime snapshot 或手动调用工具/live request。
 */
import http from "node:http";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { Server as SocketIOServer } from "socket.io";

export interface LiveRendererServerOptions {
  host?: string;
  port?: number;
  debug?: {
    enabled?: boolean;
    requireToken?: boolean;
    token?: string;
  };
  control?: {
    requireToken?: boolean;
    token?: string;
  };
  debugController?: LiveRendererDebugController;
  liveController?: LiveRendererLiveController;
}

export interface LiveRendererDebugController {
  getSnapshot(): Promise<Record<string, unknown>> | Record<string, unknown>;
  useTool?(name: string, input: Record<string, unknown>): Promise<unknown> | unknown;
  sendLiveRequest?(input: Record<string, unknown>): Promise<unknown> | unknown;
  sendLiveEvent?(input: Record<string, unknown>): Promise<unknown> | unknown;
}

export interface LiveRendererLiveController {
  sendLiveRequest?(input: Record<string, unknown>): Promise<unknown> | unknown;
  sendLiveEvent?(input: Record<string, unknown>): Promise<unknown> | unknown;
}

export interface LiveRendererCommand {
  type: string;
  [key: string]: unknown;
}

export class LiveRendererServer {
  private readonly events = new EventEmitter();
  private readonly app = express();
  private readonly server = http.createServer(this.app);
  private readonly io = new SocketIOServer(this.server, {
    cors: { origin: "*" },
  });
  private state: Record<string, unknown> = {
    visible: true,
    caption: "Stelle renderer ready.",
  };
  private readonly ttsRequests = new Map<string, { request: Record<string, unknown>; createdAt: number }>();

  constructor(private readonly options: LiveRendererServerOptions = {}) {
    this.setupRoutes();
    this.setupSocketIO();
  }

  setDebugController(controller?: LiveRendererDebugController): void {
    this.options.debugController = controller;
  }

  setLiveController(controller?: LiveRendererLiveController): void {
    this.options.liveController = controller;
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
    this.io.close();
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

  getStatus(): { connected: boolean; url: string; socketCount: number; state: Record<string, unknown> } {
    return {
      connected: this.server.listening,
      url: this.url,
      socketCount: this.io.engine.clientsCount,
      state: { ...this.state },
    };
  }

  publish(command: LiveRendererCommand): void {
    this.captureTtsRequest(command);
    if (command.type === "state:set" && command.state && typeof command.state === "object") {
      this.state = { ...(command.state as Record<string, unknown>) };
    }
    if (command.type === "caption:set" || command.type === "caption:stream") {
      this.state = { ...this.state, caption: command.text, speaker: command.speaker };
    }
    if (command.type === "caption:clear") {
      this.state = { ...this.state, caption: undefined };
    }
    if (command.type === "audio:status") {
      this.state = { ...this.state, audioStatus: command.status };
    }
    
    // 统一通过 Socket.io 广播
    this.io.emit("command", command);
  }

  private setupSocketIO() {
    this.io.on("connection", (socket) => {
      // 客户端连接时主动推送最新状态
      socket.emit("command", { type: "state:set", state: this.state });
    });
  }

  private setupRoutes() {
    this.app.use(express.json());

    this.app.get("/tts/kokoro/:id", async (req, res) => {
      const entry = this.ttsRequests.get(req.params.id);
      if (!entry) return res.status(404).json({ ok: false, error: "tts request not found or expired" });
      try {
        const response = await this.fetchKokoroAudio(entry.request);
        res.status(response.status);
        response.headers.forEach((value, key) => {
          if (!["content-encoding", "transfer-encoding", "connection"].includes(key.toLowerCase())) {
            res.setHeader(key, value);
          }
        });
        if (!response.body) return res.end();
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
        } finally {
          res.end();
          reader.releaseLock();
        }
      } catch (error) {
        res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });

    // 静态资源服务
    this.app.use("/assets", express.static(path.resolve("dist/live-renderer")));
    this.app.use("/samples", express.static(path.resolve("assets/renderer/samples")));
    this.app.use("/models", express.static(path.resolve("assets/renderer/models")));
    this.app.use("/vendor", express.static(path.resolve("assets/renderer/vendor")));

    // 页面路由
    const serveIndex = async (req: express.Request, res: express.Response) => {
      const indexPath = path.resolve("dist/live-renderer/index.html");
      const fallback = "<!doctype html><html><body><main id=\"app\">Stelle renderer ready.</main><script type=\"module\" src=\"/assets/index.js\"></script></body></html>";
      try {
        const html = await fs.readFile(indexPath, "utf8");
        res.send(html);
      } catch {
        res.send(fallback);
      }
    };
    this.app.get("/", serveIndex);
    this.app.get("/live", serveIndex);

    // 状态接口
    this.app.get("/state", (req, res) => res.json({ ok: true, state: this.state }));

    // Debug 页面与 API
    this.app.get("/_debug", (req, res) => {
      if (!this.debugAllowed(req, res)) return;
      res.send(debugHtml(this.options.debug?.requireToken !== false));
    });
    
    this.app.get("/_debug/api/snapshot", async (req, res) => {
      if (!this.debugAllowed(req, res)) return;
      if (!this.options.debugController) return res.status(503).json({ ok: false, error: "unavailable" });
      try { res.json({ ok: true, snapshot: await this.options.debugController.getSnapshot() }); }
      catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.post("/_debug/api/tool/use", async (req, res) => {
      if (!this.debugAllowed(req, res)) return;
      if (!this.options.debugController?.useTool) return res.status(503).json({ ok: false, error: "unavailable" });
      try { res.json({ ok: true, result: await this.options.debugController.useTool(req.body.name ?? "", req.body.input ?? {}) }); }
      catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.post("/_debug/api/live/request", async (req, res) => {
      if (!this.debugAllowed(req, res)) return;
      if (!this.options.debugController?.sendLiveRequest) return res.status(503).json({ ok: false, error: "unavailable" });
      try { res.json({ ok: true, result: await this.options.debugController.sendLiveRequest(req.body) }); }
      catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.post("/_debug/api/live/event", async (req, res) => {
      if (!this.debugAllowed(req, res)) return;
      if (!this.options.debugController?.sendLiveEvent) return res.status(503).json({ ok: false, error: "unavailable" });
      try { res.json({ ok: true, result: await this.options.debugController.sendLiveEvent(req.body) }); }
      catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    // 旧版控制接口
    this.app.post("/command", (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      this.publish(req.body as LiveRendererCommand);
      res.json({ ok: true, state: this.state });
    });

    this.app.post("/api/live/event", async (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      if (!this.options.liveController?.sendLiveEvent) return res.status(503).json({ ok: false, error: "unavailable" });
      try { res.json({ ok: true, result: await this.options.liveController.sendLiveEvent(req.body) }); }
      catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.post("/api/live/request", async (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      if (!this.options.liveController?.sendLiveRequest) return res.status(503).json({ ok: false, error: "unavailable" });
      try { res.json({ ok: true, result: await this.options.liveController.sendLiveRequest(req.body) }); }
      catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });
  }

  private captureTtsRequest(command: LiveRendererCommand): void {
    if (command.type !== "audio:stream" || typeof command.url !== "string") return;
    const match = command.url.match(/^\/tts\/kokoro\/([^/?#]+)/);
    if (!match) return;
    const request = command.request;
    if (!request || typeof request !== "object" || Array.isArray(request)) return;
    const now = Date.now();
    this.ttsRequests.set(match[1]!, { request: request as Record<string, unknown>, createdAt: now });
    for (const [id, entry] of this.ttsRequests) {
      if (now - entry.createdAt > 5 * 60 * 1000) this.ttsRequests.delete(id);
    }
  }

  private async fetchKokoroAudio(request: Record<string, unknown>): Promise<Response> {
    const baseUrl = (process.env.KOKORO_TTS_BASE_URL ?? "http://127.0.0.1:8880").replace(/\/+$/, "");
    const endpointPath = process.env.KOKORO_TTS_ENDPOINT_PATH ?? "/v1/audio/speech";
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (process.env.KOKORO_TTS_API_KEY) headers.authorization = `Bearer ${process.env.KOKORO_TTS_API_KEY}`;
    const response = await fetch(`${baseUrl}${endpointPath}`, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`Kokoro TTS failed: ${response.status} ${response.statusText}`);
    return response;
  }

  private debugAllowed(req: express.Request, res: express.Response): boolean {
    if (!this.options.debug?.enabled) {
      res.status(404).json({ ok: false, error: "debug disabled" });
      return false;
    }
    if (this.options.debug.requireToken === false) return true;
    const expected = this.options.debug.token;
    if (!expected) {
      res.status(403).json({ ok: false, error: "debug token is required but not configured" });
      return false;
    }
    const header = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const query = typeof req.query.token === "string" ? req.query.token : undefined;
    if (header === expected || query === expected) return true;
    res.status(401).json({ ok: false, error: "invalid debug token" });
    return false;
  }

  private controlAllowed(req: express.Request, res: express.Response): boolean {
    if (this.options.control?.requireToken === false) return true;
    const expected = this.options.control?.token;
    if (!expected) {
      res.status(403).json({ ok: false, error: "control token is required but not configured" });
      return false;
    }
    const header = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const query = typeof req.query.token === "string" ? req.query.token : undefined;
    if (header === expected || query === expected) return true;
    res.status(401).json({ ok: false, error: "invalid control token" });
    return false;
  }
}

function debugHtml(requireToken: boolean): string {
  const tokenScript = requireToken ? "const token = new URLSearchParams(location.search).get('token') || ''; const qs = token ? `?token=${encodeURIComponent(token)}` : '';" : "const qs = '';";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Stelle Debug</title></head><body><h1>Stelle Debug</h1><pre id="out">loading...</pre><script>
${tokenScript}
fetch('/_debug/api/snapshot' + qs).then(r=>r.json()).then(j=>{document.getElementById('out').textContent=JSON.stringify(j,null,2)}).catch(e=>{document.getElementById('out').textContent=String(e)})
</script></body></html>`;
}
