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
