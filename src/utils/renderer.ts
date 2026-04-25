/**
 * 模块：Live renderer HTTP/SSE 服务
 *
 * 运行逻辑：
 * - 提供 `/live` 页面和 `/assets/*` 静态资源。
 * - 提供 `/events` SSE，把 LiveRuntime 发布的舞台命令推到浏览器。
 * - 提供 debug API，读取 runtime snapshot 或手动调用工具/live request。
 *
 * 主要方法：
 * - `start()` / `stop()`：HTTP server 生命周期。
 * - `publish()`：向所有 SSE 客户端广播 renderer 命令。
 * - `handle()`：路由 HTTP 请求。
 */
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";

export interface LiveRendererServerOptions {
  host?: string;
  port?: number;
  debugController?: LiveRendererDebugController;
}

export interface LiveRendererDebugController {
  getSnapshot(): Promise<Record<string, unknown>> | Record<string, unknown>;
  useTool?(name: string, input: Record<string, unknown>): Promise<unknown> | unknown;
  sendLiveRequest?(input: Record<string, unknown>): Promise<unknown> | unknown;
}

export interface LiveRendererCommand {
  type: string;
  [key: string]: unknown;
}

export class LiveRendererServer {
  private readonly events = new EventEmitter();
  private readonly server: http.Server;
  private state: Record<string, unknown> = {
    visible: true,
    caption: "Stelle renderer ready.",
  };

  constructor(private readonly options: LiveRendererServerOptions = {}) {
    this.server = http.createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
        response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      });
    });
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
    if (command.type === "caption:set") this.state = { ...this.state, caption: command.text };
    this.events.emit("command", command);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", this.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/live")) {
      await this.serveRendererIndex(response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/_debug") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(debugHtml());
      return;
    }
    if (url.pathname.startsWith("/_debug/api/")) {
      await this.handleDebugApi(request, response, url);
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/assets/")) {
      await this.serveStatic(path.resolve("dist/live-renderer"), url.pathname, response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/state") {
      this.writeJson(response, 200, { ok: true, state: this.state });
      return;
    }
    if (request.method === "GET" && url.pathname === "/events") {
      this.handleEvents(response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/command") {
      const command = JSON.parse(await readBody(request)) as LiveRendererCommand;
      this.publish(command);
      this.writeJson(response, 200, { ok: true, state: this.state });
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }

  private async serveRendererIndex(response: ServerResponse): Promise<void> {
    const indexPath = path.resolve("dist/live-renderer/index.html");
    const fallback = "<!doctype html><html><body><main id=\"app\">Stelle renderer ready.</main><script type=\"module\" src=\"/assets/index.js\"></script></body></html>";
    const html = await fs.readFile(indexPath, "utf8").catch(() => fallback);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  }

  private async handleDebugApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const controller = this.options.debugController;
    if (!controller) {
      this.writeJson(response, 503, { ok: false, error: "debug controller unavailable" });
      return;
    }
    const body = request.method === "POST" ? parseJson(await readBody(request)) : {};
    try {
      if (request.method === "GET" && url.pathname === "/_debug/api/snapshot") {
        this.writeJson(response, 200, { ok: true, snapshot: await controller.getSnapshot() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/_debug/api/tool/use") {
        if (!controller.useTool) throw new Error("tool debug API is unavailable");
        this.writeJson(response, 200, {
          ok: true,
          result: await controller.useTool(String(body.name ?? ""), asRecord(body.input)),
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/_debug/api/live/request") {
        if (!controller.sendLiveRequest) throw new Error("live request debug API is unavailable");
        this.writeJson(response, 200, { ok: true, result: await controller.sendLiveRequest(asRecord(body)) });
        return;
      }
      this.writeJson(response, 404, { ok: false, error: "debug api not found" });
    } catch (error) {
      this.writeJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async serveStatic(root: string, pathname: string, response: ServerResponse): Promise<void> {
    const relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
    const target = path.resolve(root, relativePath);
    if (target !== root && !target.startsWith(root + path.sep)) {
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }
    try {
      const content = await fs.readFile(target);
      response.writeHead(200, { "content-type": contentType(target), "cache-control": "public, max-age=3600" });
      response.end(content);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
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

  private writeJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function parseJson(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  const parsed = JSON.parse(text) as unknown;
  return asRecord(parsed);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function debugHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Stelle Debug</title></head><body><h1>Stelle Debug</h1><pre id="out">loading...</pre><script>
fetch('/_debug/api/snapshot').then(r=>r.json()).then(j=>{document.getElementById('out').textContent=JSON.stringify(j,null,2)}).catch(e=>{document.getElementById('out').textContent=String(e)})
</script></body></html>`;
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  return "application/octet-stream";
}
