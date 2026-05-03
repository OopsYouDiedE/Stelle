import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { Server as SocketIOServer } from "socket.io";
import { allowDebugRequest } from "./renderer_auth.js";
import { fetchRendererTtsAudio, RendererTtsRequestStore } from "./renderer_tts_proxy.js";

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
}

export interface LiveRendererDebugController {
  getSnapshot(): Promise<Record<string, unknown>> | Record<string, unknown>;
}

export interface LiveRendererCommand {
  type: string;
  [key: string]: unknown;
}

export class LiveRendererServer {
  private readonly app = express();
  private readonly server = http.createServer(this.app);
  private readonly io = new SocketIOServer(this.server, { cors: { origin: "*" } });
  private readonly ttsRequests = new RendererTtsRequestStore();
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
    const host = this.options.host ?? "127.0.0.1";
    const port = this.options.port ?? 8787;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        this.server.off("listening", onListening);
        reject(error.code === "EADDRINUSE" ? new Error(`${host}:${port} is already in use.`) : error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(port, host);
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
    this.io.emit("command", command);
  }

  private setupSocketIO(): void {
    this.io.on("connection", (socket) => {
      socket.emit("command", { type: "state:set", state: this.state });
    });
  }

  private setupRoutes(): void {
    this.app.use(express.json());
    this.app.use("/assets", express.static(path.resolve("dist/live-renderer/assets")));
    this.app.use("/samples", express.static(path.resolve("assets/renderer/samples")));
    this.app.use("/models", express.static(path.resolve("assets/renderer/models")));
    this.app.use("/vendor", express.static(path.resolve("assets/renderer/vendor")));

    this.app.get("/tts/:provider/:id", async (req, res) => {
      const entry = this.ttsRequests.get(req.params.id);
      if (!entry) return res.status(404).json({ ok: false, error: "tts request not found or expired" });
      try {
        const response = await fetchRendererTtsAudio(entry);
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

    const serveIndex = async (_req: express.Request, res: express.Response) => {
      const indexPath = path.resolve("dist/live-renderer/index.html");
      try {
        res.send(await fs.readFile(indexPath, "utf8"));
      } catch {
        res.send('<!doctype html><html><body><main id="app">Stelle renderer ready.</main></body></html>');
      }
    };

    this.app.get("/", serveIndex);
    this.app.get("/live", serveIndex);
    this.app.get("/state", (_req, res) => res.json({ ok: true, state: this.state }));
    this.app.get("/_debug", (req, res) => {
      if (!this.debugAllowed(req, res)) return;
      res.send(debugHtml());
    });
    this.app.get("/debug", (req, res) => {
      if (!this.debugAllowed(req, res)) return;
      res.send(debugHtml());
    });
    this.app.get("/_debug/api/snapshot", async (req, res) => {
      if (!this.debugAllowed(req, res)) return;
      if (!this.options.debugController) return res.status(503).json({ ok: false, error: "unavailable" });
      try {
        res.json({ ok: true, snapshot: await this.options.debugController.getSnapshot() });
      } catch (error) {
        res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  private debugAllowed(req: express.Request, res: express.Response): boolean {
    if (this.options.debug?.enabled === false) {
      res.status(404).json({ ok: false, error: "debug disabled" });
      return false;
    }
    return allowDebugRequest(this.options.debug, req, res);
  }

  private captureTtsRequest(command: LiveRendererCommand): void {
    this.ttsRequests.capture(command);
  }
}

export function debugHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stelle Debug</title>
<style>
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #101113;
  color: #eceff3;
}
* { box-sizing: border-box; }
body { margin: 0; background: #101113; }
main { max-width: 1180px; margin: 0 auto; padding: 28px; }
header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 24px; }
h1, h2, h3, p { margin: 0; }
h1 { font-size: 26px; font-weight: 700; letter-spacing: 0; }
h2 { font-size: 16px; margin-bottom: 12px; color: #f6f7f9; }
h3 { font-size: 14px; margin-bottom: 6px; color: #ffffff; }
p, .muted { color: #aab1bd; font-size: 13px; line-height: 1.5; }
button {
  border: 1px solid #3a404b;
  background: #1b1e24;
  color: #f6f7f9;
  border-radius: 6px;
  padding: 8px 12px;
  cursor: pointer;
}
button:hover { background: #252a32; }
.grid { display: grid; gap: 16px; }
.stats { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-bottom: 18px; }
.panels { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); align-items: start; }
.card {
  background: #171a20;
  border: 1px solid #2b3038;
  border-radius: 8px;
  padding: 16px;
}
.stat .value { font-size: 30px; font-weight: 700; margin-top: 6px; }
.list { display: grid; gap: 8px; }
.row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 9px 10px;
  border: 1px solid #282d35;
  border-radius: 6px;
  background: #111419;
}
.row-main { min-width: 0; }
.name { font-size: 13px; color: #f6f7f9; overflow-wrap: anywhere; }
.meta { color: #8f98a7; font-size: 12px; margin-top: 2px; overflow-wrap: anywhere; }
.pill {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 12px;
  background: #252b33;
  color: #c7ced8;
}
.pill.on { background: #123f2b; color: #8df0b0; }
.pill.off { background: #3f2424; color: #ffaaa5; }
.empty { color: #737d8c; font-size: 13px; padding: 10px 0; }
details { margin-top: 16px; }
summary { cursor: pointer; color: #cfd6e0; margin-bottom: 10px; }
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: #0b0d10;
  border: 1px solid #2b3038;
  border-radius: 8px;
  padding: 14px;
  color: #d8dee8;
  max-height: 520px;
  overflow: auto;
}
.error { color: #ffaaa5; }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Stelle Debug</h1>
      <p id="subtitle">Loading runtime snapshot...</p>
    </div>
    <button id="refresh" type="button">Refresh</button>
  </header>
  <section class="grid stats" id="stats"></section>
  <section class="grid panels">
    <article class="card"><h2>Packages</h2><div class="list" id="packages"></div></article>
    <article class="card"><h2>Debug Providers</h2><div class="list" id="providers"></div></article>
    <article class="card"><h2>Resources</h2><div class="list" id="resources"></div></article>
    <article class="card"><h2>Backpressure</h2><div class="list" id="backpressure"></div></article>
    <article class="card"><h2>Audit Log</h2><div class="list" id="audit"></div></article>
  </section>
  <details>
    <summary>Raw snapshot JSON</summary>
    <pre id="raw">loading</pre>
  </details>
</main>
<script>
const ids = ["stats", "packages", "providers", "resources", "backpressure", "audit", "raw", "subtitle"];
const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
document.getElementById("refresh").addEventListener("click", load);

function apiUrl() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  return token ? "/_debug/api/snapshot?token=" + encodeURIComponent(token) : "/_debug/api/snapshot";
}

async function load() {
  el.subtitle.textContent = "Loading runtime snapshot...";
  try {
    const response = await fetch(apiUrl());
    const payload = await response.json();
    if (!response.ok || payload.ok === false) throw new Error(payload.error || response.statusText);
    render(payload.snapshot ?? payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    el.subtitle.innerHTML = '<span class="error">' + escapeHtml(message) + '</span>';
    el.raw.textContent = message;
  }
}

function render(snapshot) {
  const packages = snapshot.packages || [];
  const active = packages.filter(pkg => pkg.active);
  const capabilities = snapshot.capabilities || [];
  const windows = snapshot.windows || [];
  const providers = snapshot.providers || [];
  const resources = snapshot.resources || [];
  const streams = snapshot.streams || [];
  const backpressure = snapshot.backpressure || [];
  const audit = snapshot.auditLog || [];

  el.subtitle.textContent = "Security: " + (snapshot.securityMode || "unknown") + " | " + new Date().toLocaleString();
  el.stats.innerHTML = [
    stat("Active packages", active.length + "/" + packages.length),
    stat("Capabilities", capabilities.length),
    stat("Windows", windows.length),
    stat("Providers", providers.length),
    stat("Resources", resources.length + streams.length),
  ].join("");

  el.packages.innerHTML = list(packages, pkg => row(pkg.displayName || pkg.id, pkg.id + " | " + pkg.kind + " | v" + pkg.version, pkg.active ? "active" : "inactive", pkg.active));
  el.providers.innerHTML = list(providers, provider => row(provider.title || provider.id, provider.id + " | owner " + provider.ownerPackageId, provider.commandCount + " cmds"));
  el.resources.innerHTML = list([...resources, ...streams], item => row(item.id || item.uri || item.name || "resource", item.kind || item.mimeType || item.accessScope || "runtime data", item.debugReadable ? "debug" : "scoped"));
  el.backpressure.innerHTML = list(backpressure, item => row(item.id || item.owner || item.queue || "queue", "buffered=" + (item.buffered ?? 0) + " dropped=" + (item.dropped ?? 0), item.recommendedAction || item.status || "ok"));
  el.audit.innerHTML = list(audit.slice(-12).reverse(), item => row(item.providerId + ":" + item.commandId, item.reason || "audit", item.allowed ? "allowed" : "blocked", item.allowed));
  el.raw.textContent = JSON.stringify(snapshot, null, 2);
}

function stat(label, value) {
  return '<article class="card stat"><p>' + escapeHtml(label) + '</p><div class="value">' + escapeHtml(String(value)) + '</div></article>';
}

function list(items, map) {
  return items.length ? items.map(map).join("") : '<div class="empty">No data yet.</div>';
}

function row(name, meta, pill, enabled) {
  const cls = enabled === true ? " on" : enabled === false ? " off" : "";
  return '<div class="row"><div class="row-main"><div class="name">' + escapeHtml(String(name)) + '</div><div class="meta">' + escapeHtml(String(meta || "")) + '</div></div><span class="pill' + cls + '">' + escapeHtml(String(pill || "")) + '</span></div>';
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

load();
</script>
</body>
</html>`;
}
