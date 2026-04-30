/**
 * 模块：Live renderer HTTP/SSE 服务 (Express + Socket.io)
 *
 * 运行逻辑：
 * - 提供 `/live` 页面、`/assets/*` 静态资源和 `/samples/*` 测试样本。
 * - 提供 Socket.io 实时通信，把 LiveRuntime 发布的舞台命令推到浏览器。
 * - 提供 debug API，读取 runtime snapshot 或手动调用工具/live request。
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { Server as SocketIOServer } from "socket.io";
import { fetchLiveTtsAudio, normalizeTtsProvider, type TtsProviderName } from "./tts.js";
import type { MemoryLayer, MemoryProposalStatus, MemoryScope } from "./memory.js";

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
  memoryController?: LiveRendererMemoryController;
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
  getHealth?(): Promise<unknown> | unknown;
  getJournal?(limit?: number): Promise<unknown> | unknown;
  runControlCommand?(input: Record<string, unknown>): Promise<unknown> | unknown;
  getViewerProfile?(platform: string, viewerId: string): Promise<unknown> | unknown;
  deleteViewerProfile?(platform: string, viewerId: string): Promise<unknown> | unknown;
}

export interface LiveRendererMemoryController {
  snapshot?(): Promise<unknown> | unknown;
  readRecent?(scope: MemoryScope, limit?: number): Promise<unknown> | unknown;
  search?(scope: MemoryScope, input: { text?: string; keywords?: string[]; limit?: number; layers?: MemoryLayer[] }): Promise<unknown> | unknown;
  readLongTerm?(key: string, layer?: MemoryLayer): Promise<unknown> | unknown;
  writeLongTerm?(key: string, value: string, layer?: MemoryLayer): Promise<unknown> | unknown;
  appendLongTerm?(key: string, value: string, layer?: MemoryLayer): Promise<unknown> | unknown;
  propose?(input: { content: string; reason: string; layer?: MemoryLayer; authorId?: string; source?: string }): Promise<unknown> | unknown;
  listProposals?(input?: { limit?: number; status?: MemoryProposalStatus }): Promise<unknown> | unknown;
  approveProposal?(input: { proposalId: string; targetKey?: string; reason?: string; decidedBy?: string }): Promise<unknown> | unknown;
  rejectProposal?(input: { proposalId: string; reason?: string; decidedBy?: string }): Promise<unknown> | unknown;
}

export interface LiveRendererCommand {
  type: string;
  [key: string]: unknown;
}

export class LiveRendererServer {
  private readonly app = express();
  private readonly server = http.createServer(this.app);
  private readonly io = new SocketIOServer(this.server, {
    cors: { origin: "*" },
  });
  private state: Record<string, unknown> = {
    visible: true,
    caption: "Stelle renderer ready.",
  };
  private readonly ttsRequests = new Map<string, { provider: TtsProviderName; request: Record<string, unknown>; createdAt: number }>();

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

  setMemoryController(controller?: LiveRendererMemoryController): void {
    this.options.memoryController = controller;
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

  publishHealth(snapshot: unknown): void {
    this.io.emit("health:update", snapshot);
  }

  private setupSocketIO() {
    this.io.on("connection", (socket) => {
      // 客户端连接时主动推送最新状态
      socket.emit("command", { type: "state:set", state: this.state });
    });
  }

  private setupRoutes() {
    this.app.use(express.json());

    this.app.get("/tts/:provider/:id", async (req, res) => {
      const entry = this.ttsRequests.get(req.params.id);
      if (!entry) return res.status(404).json({ ok: false, error: "tts request not found or expired" });
      try {
        const response = await fetchLiveTtsAudio(entry.provider, entry.request);
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
        this.publish({ type: "audio:status", status: "error", provider: req.params.provider, text: error instanceof Error ? error.message : String(error) });
        res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });

    // 静态资源服务
    this.app.use("/assets", express.static(path.resolve("dist/live-renderer/assets")));
    this.app.use("/samples", express.static(path.resolve("assets/renderer/samples")));
    this.app.use("/models", express.static(path.resolve("assets/renderer/models")));
    this.app.use("/vendor", express.static(path.resolve("assets/renderer/vendor")));

    // 页面路由
    const serveIndex = async (_req: express.Request, res: express.Response) => {
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
    this.app.get("/state", (_req, res) => res.json({ ok: true, state: this.state }));

    // Debug 页面与 API
    const serveDebugPage = (req: express.Request, res: express.Response) => {
      if (!this.debugAllowed(req, res)) return;
      res.send(debugHtml(this.options.debug?.requireToken !== false));
    };
    this.app.get("/_debug", serveDebugPage);
    this.app.get("/debug", serveDebugPage);

    this.app.get("/control", (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      res.send(controlHtml(this.options.control?.requireToken !== false));
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

    this.app.post("/_debug/api/live/control", async (req, res) => {
      if (!this.debugAllowed(req, res)) return;
      if (!this.options.liveController?.runControlCommand) return res.status(503).json({ ok: false, error: "unavailable" });
      try { res.json({ ok: true, result: await this.options.liveController.runControlCommand(req.body) }); }
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

    this.app.get("/api/live/health", async (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      if (!this.options.liveController?.getHealth) return res.status(503).json({ ok: false, error: "unavailable" });
      try {
        const snapshot = await this.options.liveController.getHealth();
        this.publishHealth(snapshot);
        res.json({ ok: true, snapshot });
      } catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.get("/api/live/journal", async (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      if (!this.options.liveController?.getJournal) return res.status(503).json({ ok: false, error: "unavailable" });
      try { res.json({ ok: true, journal: await this.options.liveController.getJournal(Number(req.query.limit ?? 40)) }); }
      catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.post("/api/live/control", async (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      if (!this.options.liveController?.runControlCommand) return res.status(503).json({ ok: false, error: "unavailable" });
      try { res.json({ ok: true, result: await this.options.liveController.runControlCommand(req.body) }); }
      catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.get("/api/memory/snapshot", async (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      if (!this.options.memoryController?.snapshot) return res.status(503).json({ ok: false, error: "memory unavailable" });
      try { res.json({ ok: true, snapshot: await this.options.memoryController.snapshot() }); }
      catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.post("/api/memory/recent/read", async (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      if (!this.options.memoryController?.readRecent) return res.status(503).json({ ok: false, error: "memory unavailable" });
      try {
        const body = req.body as Record<string, unknown>;
        res.json({ ok: true, entries: await this.options.memoryController.readRecent(body.scope as MemoryScope, Number(body.limit ?? 20)) });
      } catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.post("/api/memory/search", async (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      if (!this.options.memoryController?.search) return res.status(503).json({ ok: false, error: "memory unavailable" });
      try {
        const body = req.body as Record<string, unknown>;
        res.json({
          ok: true,
          results: await this.options.memoryController.search(body.scope as MemoryScope, {
            text: typeof body.text === "string" ? body.text : undefined,
            keywords: Array.isArray(body.keywords) ? body.keywords.map(String) : undefined,
            limit: body.limit === undefined ? undefined : Number(body.limit),
            layers: Array.isArray(body.layers) ? body.layers.map(String) as MemoryLayer[] : undefined,
          }),
        });
      } catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.get("/api/memory/long-term/:layer/:key", async (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      if (!this.options.memoryController?.readLongTerm) return res.status(503).json({ ok: false, error: "memory unavailable" });
      try { res.json({ ok: true, value: await this.options.memoryController.readLongTerm(req.params.key, req.params.layer as MemoryLayer) }); }
      catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.put("/api/memory/long-term/:layer/:key", async (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      if (!this.options.memoryController?.writeLongTerm) return res.status(503).json({ ok: false, error: "memory unavailable" });
      try {
        await this.options.memoryController.writeLongTerm(req.params.key, String((req.body as Record<string, unknown>).value ?? ""), req.params.layer as MemoryLayer);
        res.json({ ok: true });
      } catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.post("/api/memory/long-term/:layer/:key/append", async (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      if (!this.options.memoryController?.appendLongTerm) return res.status(503).json({ ok: false, error: "memory unavailable" });
      try {
        await this.options.memoryController.appendLongTerm(req.params.key, String((req.body as Record<string, unknown>).value ?? ""), req.params.layer as MemoryLayer);
        res.json({ ok: true });
      } catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.post("/api/memory/propose", async (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      if (!this.options.memoryController?.propose) return res.status(503).json({ ok: false, error: "memory unavailable" });
      try {
        const body = req.body as Record<string, unknown>;
        const result = await this.options.memoryController.propose({
          content: String(body.content ?? ""),
          reason: String(body.reason ?? ""),
          layer: body.layer as MemoryLayer | undefined,
          authorId: typeof body.authorId === "string" ? body.authorId : undefined,
          source: typeof body.source === "string" ? body.source : undefined,
        });
        res.json({ ok: true, result });
      } catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.get("/api/memory/proposals", async (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      if (!this.options.memoryController?.listProposals) return res.status(503).json({ ok: false, error: "memory unavailable" });
      try {
        res.json({
          ok: true,
          proposals: await this.options.memoryController.listProposals({
            limit: Number(req.query.limit ?? 50),
            status: typeof req.query.status === "string" ? req.query.status as MemoryProposalStatus : undefined,
          }),
        });
      } catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.post("/api/memory/proposals/:proposalId/approve", async (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      if (!this.options.memoryController?.approveProposal) return res.status(503).json({ ok: false, error: "memory unavailable" });
      try {
        const body = req.body as Record<string, unknown>;
        res.json({ ok: true, result: await this.options.memoryController.approveProposal({
          proposalId: req.params.proposalId,
          targetKey: typeof body.targetKey === "string" ? body.targetKey : undefined,
          reason: typeof body.reason === "string" ? body.reason : undefined,
          decidedBy: typeof body.decidedBy === "string" ? body.decidedBy : undefined,
        }) });
      } catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.post("/api/memory/proposals/:proposalId/reject", async (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      if (!this.options.memoryController?.rejectProposal) return res.status(503).json({ ok: false, error: "memory unavailable" });
      try {
        const body = req.body as Record<string, unknown>;
        res.json({ ok: true, result: await this.options.memoryController.rejectProposal({
          proposalId: req.params.proposalId,
          reason: typeof body.reason === "string" ? body.reason : undefined,
          decidedBy: typeof body.decidedBy === "string" ? body.decidedBy : undefined,
        }) });
      } catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.get("/api/live/viewer/:platform/:viewerId", async (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      if (!this.options.liveController?.getViewerProfile) return res.status(503).json({ ok: false, error: "unavailable" });
      try { res.json({ ok: true, profile: await this.options.liveController.getViewerProfile(req.params.platform, req.params.viewerId) }); }
      catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.delete("/api/live/viewer/:platform/:viewerId", async (req, res) => {
      if (!this.controlAllowed(req, res)) return;
      if (!this.options.liveController?.deleteViewerProfile) return res.status(503).json({ ok: false, error: "unavailable" });
      try { res.json({ ok: true, result: await this.options.liveController.deleteViewerProfile(req.params.platform, req.params.viewerId) }); }
      catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });
  }

  private captureTtsRequest(command: LiveRendererCommand): void {
    if (command.type !== "audio:stream" || typeof command.url !== "string") return;
    const match = command.url.match(/^\/tts\/([^/?#]+)\/([^/?#]+)/);
    if (!match) return;
    const request = command.request;
    if (!request || typeof request !== "object" || Array.isArray(request)) return;
    const now = Date.now();
    this.ttsRequests.set(match[2]!, { provider: normalizeTtsProvider(match[1]!), request: request as Record<string, unknown>, createdAt: now });
    for (const [id, entry] of this.ttsRequests) {
      if (now - entry.createdAt > 5 * 60 * 1000) this.ttsRequests.delete(id);
    }
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
  const tokenScript = requireToken ? "const token = new URLSearchParams(location.search).get('token') || '';" : "const token = '';";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Stelle Debug Panel</title><style>
:root{color-scheme:dark;--bg:#0d1117;--panel:#151b23;--panel2:#0f1620;--line:#303b49;--muted:#8b9aac;--text:#e6edf3;--accent:#7cc7ff;--good:#8ee0b3;--warn:#f0bd6a;--bad:#ff8c8c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Segoe UI,Microsoft YaHei,Arial,sans-serif;font-size:14px}
main{max-width:1680px;margin:0 auto;padding:18px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
header{grid-column:1/-1;display:flex;align-items:end;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding-bottom:12px}
h1,h2{margin:0}h1{font-size:22px}h2{font-size:14px;color:var(--accent);font-weight:650}
.hint{color:var(--muted);font-size:12px}.cards{grid-column:1/-1;display:grid;grid-template-columns:repeat(8,minmax(120px,1fr));gap:10px}
.card,section{border:1px solid var(--line);background:var(--panel);border-radius:8px}.card{padding:10px;min-width:0}.label{color:var(--muted);font-size:12px}.value{font-size:18px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}
section{padding:12px;min-width:0}.wide{grid-column:span 2}.full{grid-column:1/-1}.stack{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.row{display:flex;gap:8px;align-items:center;margin:10px 0}.row>*{min-width:0}
button,input,textarea{border:1px solid #3a4656;background:var(--panel2);color:var(--text);border-radius:6px;padding:8px;font:inherit}button{cursor:pointer}button:hover{border-color:var(--accent)}button.danger{border-color:#8f3b3b;background:#341b1f}input{width:100%}textarea{width:100%;min-height:96px;resize:vertical}
pre{margin:10px 0 0;white-space:pre-wrap;word-break:break-word;background:var(--panel2);border:1px solid #283443;border-radius:6px;padding:10px;max-height:320px;overflow:auto;font-size:12px}.smallpre{max-height:210px}.ok{color:var(--good)}.warn{color:var(--warn)}.bad{color:var(--bad)}
table{width:100%;border-collapse:collapse;margin-top:8px}td,th{border-bottom:1px solid #263140;padding:7px;text-align:left;vertical-align:top}th{color:var(--muted);font-weight:500}.pill{display:inline-block;border:1px solid #3a4656;border-radius:999px;padding:2px 8px;margin:2px 4px 2px 0;color:#c9d7e3}
@media (max-width:1100px){main{grid-template-columns:1fr}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.wide{grid-column:auto}}
</style></head><body><main>
<header><div><h1>Stelle Debug Panel</h1><div class="hint">Independent control room. Live stage remains clean at /live.</div></div><div id="status" class="warn">loading</div></header>
<div class="cards" id="cards"></div>
<section><h2>Stage Control</h2><div class="stack"><button class="danger" data-cmd="stop_output">Stop Output</button><button data-cmd="clear_queue">Clear Queue</button><button data-cmd="pause_auto_reply">Pause Auto Reply</button><button data-cmd="resume_auto_reply">Resume Auto Reply</button><button data-cmd="mute_tts">Mute TTS</button><button data-cmd="unmute_tts">Unmute TTS</button></div><div class="row"><input id="say" placeholder="Direct say text"><button id="saybtn">Direct Say</button></div><pre id="controlResult" class="smallpre"></pre></section>
<section><h2>Cursors</h2><div id="cursors"></div></section>
<section><h2>Recent Runtime Events</h2><pre id="events" class="smallpre"></pre></section>
<section class="wide"><h2>Stage Output</h2><div id="stage"></div><pre id="outputs"></pre></section>
<section><h2>Renderer / Live</h2><pre id="renderer" class="smallpre"></pre></section>
<section class="wide"><h2>Tools & Audit</h2><div id="tools"></div><pre id="audit" class="smallpre"></pre></section>
<section><h2>Manual Live Event</h2><textarea id="liveEvent">{"platform":"debug","viewerId":"debug-user","username":"Debug User","text":"测试弹幕"}</textarea><div class="stack"><button id="eventbtn">Send Event</button></div><pre id="eventResult" class="smallpre"></pre></section>
<section><h2>Manual Live Request</h2><textarea id="liveRequest">{"text":"请用一句话测试直播输出","forceTopic":false}</textarea><div class="stack"><button id="requestbtn">Send Request</button></div><pre id="requestResult" class="smallpre"></pre></section>
<section class="full"><h2>Raw Snapshot</h2><pre id="raw"></pre></section>
</main><script>
${tokenScript}
let latest = null;
const byId = (id) => document.getElementById(id);
function withToken(path){
  if (!token) return path;
  const sep = path.includes('?') ? '&' : '?';
  return path + sep + 'token=' + encodeURIComponent(token);
}
async function api(path, init){
  const headers = { 'content-type': 'application/json', ...(init && init.headers ? init.headers : {}) };
  const res = await fetch(withToken(path), { ...init, headers });
  const data = await res.json().catch(() => ({ ok:false, error:'bad json' }));
  if (!res.ok || data.ok === false) throw new Error(data.error || res.statusText);
  return data;
}
function pretty(value){ return JSON.stringify(value ?? null, null, 2); }
function text(value, fallback='unknown'){ return value === undefined || value === null || value === '' ? fallback : String(value); }
function esc(value, fallback='unknown'){
  return text(value, fallback).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function parseJson(id){
  try { return JSON.parse(byId(id).value || '{}'); }
  catch (error) { throw new Error('Invalid JSON in ' + id + ': ' + error.message); }
}
function renderCards(snapshot){
  const runtime = snapshot.runtime || {};
  const stage = snapshot.stageOutput || {};
  const renderer = snapshot.renderer || {};
  const cards = [
    ['Runtime', runtime.lastError ? 'error' : 'ok', runtime.lastError ? 'bad' : 'ok'],
    ['Renderer', renderer.connected ? 'connected' : 'offline', renderer.connected ? 'ok' : 'warn'],
    ['Discord', snapshot.discord && snapshot.discord.connected ? 'connected' : 'offline', snapshot.discord && snapshot.discord.connected ? 'ok' : 'warn'],
    ['Stage', text(stage.status), stage.speaking ? 'warn' : 'ok'],
    ['Queue', text(stage.queueLength, '0'), Number(stage.queueLength || 0) > 0 ? 'warn' : 'ok'],
    ['Auto Reply', stage.autoReplyPaused ? 'paused' : 'running', stage.autoReplyPaused ? 'warn' : 'ok'],
    ['TTS', stage.ttsMuted ? 'muted' : 'enabled', stage.ttsMuted ? 'warn' : 'ok'],
    ['Sockets', text(renderer.socketCount, '0'), Number(renderer.socketCount || 0) > 0 ? 'ok' : 'warn'],
  ];
  byId('cards').innerHTML = cards.map(([label,value,cls]) => '<div class="card"><div class="label">' + esc(label) + '</div><div class="value ' + cls + '">' + esc(value) + '</div></div>').join('');
}
function renderCursors(cursors){
  const entries = Object.values(cursors || {});
  if (!entries.length) { byId('cursors').innerHTML = '<div class="hint">No cursor snapshots yet.</div>'; return; }
  byId('cursors').innerHTML = '<table><thead><tr><th>ID</th><th>Status</th><th>Last Active</th></tr></thead><tbody>' + entries.map((c) => '<tr><td>' + esc(c.id) + '</td><td>' + esc(c.status || c.state?.status) + '</td><td>' + esc(c.lastActiveAt || c.state?.lastActiveAt) + '</td></tr>').join('') + '</tbody></table>';
}
function renderTools(tools){
  const items = (tools || []).map((tool) => '<span class="pill">' + esc(tool.name) + ' / ' + esc(tool.authority) + '</span>');
  byId('tools').innerHTML = items.length ? items.join('') : '<div class="hint">No tools registered.</div>';
}
function render(snapshot){
  latest = snapshot;
  renderCards(snapshot);
  renderCursors(snapshot.runtime && snapshot.runtime.cursors);
  renderTools(snapshot.tools);
  const stage = snapshot.stageOutput || {};
  byId('stage').innerHTML = '<div class="hint">Current: ' + esc(stage.currentOutputId, 'none') + ' / owner: ' + esc(stage.currentOwner, 'none') + ' / lane: ' + esc(stage.currentLane, 'none') + '</div>';
  byId('outputs').textContent = pretty(stage.recentOutputs || []);
  byId('events').textContent = pretty((snapshot.runtime && snapshot.runtime.recentEvents) || []);
  byId('renderer').textContent = pretty({ renderer: snapshot.renderer, live: snapshot.live, discord: snapshot.discord, memory: snapshot.memory });
  byId('audit').textContent = pretty(snapshot.audit || []);
  byId('raw').textContent = pretty(snapshot);
  byId('status').textContent = 'updated ' + new Date().toLocaleTimeString();
  byId('status').className = 'ok';
}
async function refresh(){
  try {
    const data = await api('/_debug/api/snapshot');
    render(data.snapshot || {});
  } catch (error) {
    byId('status').textContent = String(error);
    byId('status').className = 'bad';
  }
}
async function runControl(command, payload={}){
  try {
    byId('controlResult').textContent = pretty(await api('/_debug/api/live/control', { method:'POST', body: JSON.stringify({ command, ...payload }) }));
    await refresh();
  } catch (error) {
    byId('controlResult').textContent = String(error);
  }
}
document.querySelectorAll('button[data-cmd]').forEach((button) => button.onclick = () => runControl(button.dataset.cmd));
byId('saybtn').onclick = () => runControl('direct_say', { text: byId('say').value });
byId('eventbtn').onclick = async () => {
  try { byId('eventResult').textContent = pretty(await api('/_debug/api/live/event', { method:'POST', body: JSON.stringify(parseJson('liveEvent')) })); await refresh(); }
  catch (error) { byId('eventResult').textContent = String(error); }
};
byId('requestbtn').onclick = async () => {
  try { byId('requestResult').textContent = pretty(await api('/_debug/api/live/request', { method:'POST', body: JSON.stringify(parseJson('liveRequest')) })); await refresh(); }
  catch (error) { byId('requestResult').textContent = String(error); }
};
refresh();
setInterval(refresh, 5000);
</script></body></html>`;
}

function controlHtml(requireToken: boolean): string {
  const tokenScript = requireToken ? "const token = new URLSearchParams(location.search).get('token') || ''; const qs = token ? `?token=${encodeURIComponent(token)}` : '';" : "const qs = '';";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Stelle Live Control</title><style>
body{margin:0;background:#0b1118;color:#dbe7ef;font-family:Segoe UI,Microsoft YaHei,sans-serif}
main{display:grid;grid-template-columns:1.2fr .8fr;gap:16px;padding:18px;min-height:100vh}
section{border:1px solid #263746;background:#111a24;border-radius:8px;padding:14px;min-width:0}
h1,h2{margin:0 0 12px} h1{font-size:20px} h2{font-size:15px;color:#f0bd6a}
pre{white-space:pre-wrap;word-break:break-word;background:#081018;border:1px solid #22303c;border-radius:6px;padding:10px;max-height:42vh;overflow:auto}
button,input{border:1px solid #33495c;background:#182635;color:#e8f1f7;border-radius:6px;padding:9px;margin:4px 4px 4px 0}
button{cursor:pointer} .danger{border-color:#8f3b3b;background:#3a1818}.ok{color:#8ee0c2}.warn{color:#f0bd6a}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.wide{grid-column:1/-1}
</style></head><body><main>
<section><h1>Stelle Live Control</h1><div id="status" class="warn">loading</div><pre id="health"></pre></section>
<section><h2>Stage Controls</h2><button class="danger" data-cmd="stop_output">Stop Output</button><button data-cmd="clear_queue">Clear Queue</button><button data-cmd="pause_auto_reply">Pause Auto Reply</button><button data-cmd="resume_auto_reply">Resume</button><button data-cmd="mute_tts">Mute TTS</button><button data-cmd="unmute_tts">Unmute TTS</button><h2>Direct Say</h2><input id="say" placeholder="一句要立刻说的话" style="width:75%"><button id="saybtn">Send</button><pre id="result"></pre></section>
<section class="wide"><h2>Recent Journal</h2><pre id="journal"></pre></section>
</main><script src="/socket.io/socket.io.js"></script><script>
${tokenScript}
const h=document.getElementById('health'),j=document.getElementById('journal'),r=document.getElementById('result'),s=document.getElementById('status');
async function api(path,init){const res=await fetch(path+qs,{headers:{'content-type':'application/json'},...init});const data=await res.json().catch(()=>({ok:false,error:'bad json'}));if(!res.ok)throw new Error(data.error||res.statusText);return data}
async function refresh(){try{const data=await api('/api/live/health');h.textContent=JSON.stringify(data.snapshot,null,2);s.textContent='connected';s.className='ok';const log=await api('/api/live/journal?limit=30');j.textContent=JSON.stringify(log.journal,null,2)}catch(e){s.textContent=String(e);s.className='warn'}}
async function cmd(command,payload={}){try{r.textContent=JSON.stringify(await api('/api/live/control',{method:'POST',body:JSON.stringify({command,...payload})}),null,2);await refresh()}catch(e){r.textContent=String(e)}}
document.querySelectorAll('button[data-cmd]').forEach(b=>b.onclick=()=>cmd(b.dataset.cmd));
document.getElementById('saybtn').onclick=()=>cmd('direct_say',{text:document.getElementById('say').value});
try{io().on('health:update',x=>{h.textContent=JSON.stringify(x,null,2)})}catch{}
refresh();setInterval(refresh,5000);
</script></body></html>`;
}
