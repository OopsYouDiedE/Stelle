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
import { createProxyMiddleware } from "http-proxy-middleware";

export interface LiveRendererServerOptions {
  host?: string;
  port?: number;
  debugController?: LiveRendererDebugController;
}

export interface LiveRendererDebugController {
  getSnapshot(): Promise<Record<string, unknown>> | Record<string, unknown>;
  useTool?(name: string, input: Record<string, unknown>): Promise<unknown> | unknown;
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

  constructor(private readonly options: LiveRendererServerOptions = {}) {
    this.setupRoutes();
    this.setupSocketIO();
  }

  setDebugController(controller?: LiveRendererDebugController): void {
    this.options.debugController = controller;
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

  publish(command: LiveRendererCommand): void {
    if (command.type === "state:set" && command.state && typeof command.state === "object") {
      this.state = { ...(command.state as Record<string, unknown>) };
    }
    if (command.type === "caption:set" || command.type === "caption:stream") {
      this.state = { ...this.state, caption: command.text, speaker: command.speaker };
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
    // 代理 Kokoro TTS
    const baseUrl = (process.env.KOKORO_TTS_BASE_URL ?? "http://127.0.0.1:8880").replace(/\/+$/, "");
    const endpointPath = process.env.KOKORO_TTS_ENDPOINT_PATH ?? "/v1/audio/speech";
    this.app.use(
      "/tts/kokoro",
      createProxyMiddleware({
        target: baseUrl,
        changeOrigin: true,
        pathRewrite: {
          "^/tts/kokoro/.*": endpointPath, // 重写路径以匹配 Python 服务的实际地址
        },
        on: {
          proxyReq: (proxyReq, req: any) => {
             // 透传 API key (如有)
             if (process.env.KOKORO_TTS_API_KEY) {
                proxyReq.setHeader("authorization", `Bearer ${process.env.KOKORO_TTS_API_KEY}`);
             }
             // SSE/Wav 需要特殊处理的地方由于使用 proxyMiddleware 可以透明处理
             
             // 把由于我们在 LiveRuntime 生成的特殊流播放请求进行重构有点复杂，我们先用简单转发。
             // Note: 由于代理中间件在 body parser 前比较好，这里不需要再自己写复杂的流转发
             if (req.body) {
               const bodyData = JSON.stringify(req.body);
               proxyReq.setHeader('Content-Type', 'application/json');
               proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
               proxyReq.write(bodyData);
             }
          }
        }
      })
    );

    this.app.use(express.json());

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
    this.app.get("/_debug", (req, res) => res.send(debugHtml()));
    
    this.app.get("/_debug/api/snapshot", async (req, res) => {
      if (!this.options.debugController) return res.status(503).json({ ok: false, error: "unavailable" });
      try { res.json({ ok: true, snapshot: await this.options.debugController.getSnapshot() }); }
      catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.post("/_debug/api/tool/use", async (req, res) => {
      if (!this.options.debugController?.useTool) return res.status(503).json({ ok: false, error: "unavailable" });
      try { res.json({ ok: true, result: await this.options.debugController.useTool(req.body.name ?? "", req.body.input ?? {}) }); }
      catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.post("/_debug/api/live/request", async (req, res) => {
      if (!this.options.debugController?.sendLiveRequest) return res.status(503).json({ ok: false, error: "unavailable" });
      try { res.json({ ok: true, result: await this.options.debugController.sendLiveRequest(req.body) }); }
      catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    this.app.post("/_debug/api/live/event", async (req, res) => {
      if (!this.options.debugController?.sendLiveEvent) return res.status(503).json({ ok: false, error: "unavailable" });
      try { res.json({ ok: true, result: await this.options.debugController.sendLiveEvent(req.body) }); }
      catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });

    // 旧版控制接口
    this.app.post("/command", (req, res) => {
      this.publish(req.body as LiveRendererCommand);
      res.json({ ok: true, state: this.state });
    });

    this.app.post("/api/live/event", async (req, res) => {
      if (!this.options.debugController?.sendLiveEvent) return res.status(503).json({ ok: false, error: "unavailable" });
      try { res.json({ ok: true, result: await this.options.debugController.sendLiveEvent(req.body) }); }
      catch(e) { res.status(500).json({ ok: false, error: String(e) }); }
    });
  }
}

function debugHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Stelle Debug</title></head><body><h1>Stelle Debug</h1><pre id="out">loading...</pre><script>
fetch('/_debug/api/snapshot').then(r=>r.json()).then(j=>{document.getElementById('out').textContent=JSON.stringify(j,null,2)}).catch(e=>{document.getElementById('out').textContent=String(e)})
</script></body></html>`;
}
