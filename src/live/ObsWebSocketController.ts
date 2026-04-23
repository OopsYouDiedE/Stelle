import crypto from "node:crypto";
import type { LiveActionResult, ObsController, ObsStatus } from "./types.js";

interface ObsSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: { data?: unknown; error?: unknown }) => void): void;
}

export type ObsWebSocketFactory = (url: string) => ObsSocket;

interface ObsRpcMessage {
  op: number;
  d?: {
    rpcVersion?: number;
    authentication?: {
      challenge: string;
      salt: string;
    };
    requestType?: string;
    requestId?: string;
    requestStatus?: {
      result: boolean;
      code: number;
      comment?: string;
    };
    requestData?: Record<string, unknown>;
    responseData?: Record<string, unknown>;
  };
}

function now(): number {
  return Date.now();
}

function ok(summary: string, obs: ObsStatus): LiveActionResult {
  return { ok: true, summary, timestamp: now(), obs };
}

function unavailable(message: string, status: ObsStatus): LiveActionResult {
  return {
    ok: false,
    summary: message,
    timestamp: now(),
    obs: status,
    error: { code: "obs_unavailable", message, retryable: true },
  };
}

function base64Sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("base64");
}

function obsAuthentication(password: string, salt: string, challenge: string): string {
  const secret = base64Sha256(password + salt);
  return base64Sha256(secret + challenge);
}

export interface ObsWebSocketControllerOptions {
  url?: string;
  password?: string;
  enabled?: boolean;
  timeoutMs?: number;
  socketFactory?: ObsWebSocketFactory;
}

export class ObsWebSocketController implements ObsController {
  private status: ObsStatus;
  private readonly timeoutMs: number;
  private readonly socketFactory?: ObsWebSocketFactory;

  constructor(private readonly options: ObsWebSocketControllerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.socketFactory = options.socketFactory;
    this.status = {
      enabled: options.enabled ?? process.env.OBS_CONTROL_ENABLED === "true",
      connected: false,
      streaming: false,
      url: options.url ?? process.env.OBS_WEBSOCKET_URL ?? "ws://127.0.0.1:4455",
    };
  }

  async getStatus(): Promise<ObsStatus> {
    if (!this.status.enabled) return { ...this.status, connected: false };
    try {
      const studioMode = await this.request("GetStudioModeEnabled");
      const streamStatus = await this.request("GetStreamStatus");
      const scene = await this.request("GetCurrentProgramScene");
      this.status = {
        ...this.status,
        connected: true,
        streaming: Boolean(streamStatus.outputActive),
        currentScene: typeof scene.currentProgramSceneName === "string" ? scene.currentProgramSceneName : this.status.currentScene,
        lastError: undefined,
      };
      void studioMode;
    } catch (error) {
      this.status = {
        ...this.status,
        connected: false,
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
    return { ...this.status };
  }

  async startStream(): Promise<LiveActionResult> {
    if (!this.status.enabled) return unavailable("OBS control is disabled.", { ...this.status });
    try {
      await this.request("StartStream");
      this.status = { ...this.status, connected: true, streaming: true, lastError: undefined };
      return ok("OBS streaming started.", { ...this.status });
    } catch (error) {
      return this.fail(error);
    }
  }

  async stopStream(): Promise<LiveActionResult> {
    if (!this.status.enabled) return unavailable("OBS control is disabled.", { ...this.status });
    try {
      await this.request("StopStream");
      this.status = { ...this.status, connected: true, streaming: false, lastError: undefined };
      return ok("OBS streaming stopped.", { ...this.status });
    } catch (error) {
      return this.fail(error);
    }
  }

  async setCurrentScene(sceneName: string): Promise<LiveActionResult> {
    if (!this.status.enabled) return unavailable("OBS control is disabled.", { ...this.status });
    try {
      await this.request("SetCurrentProgramScene", { sceneName });
      this.status = { ...this.status, connected: true, currentScene: sceneName, lastError: undefined };
      return ok(`OBS scene set to ${sceneName}.`, { ...this.status });
    } catch (error) {
      return this.fail(error);
    }
  }

  private fail(error: unknown): LiveActionResult {
    const message = error instanceof Error ? error.message : String(error);
    this.status = { ...this.status, connected: false, lastError: message };
    return unavailable(message, { ...this.status });
  }

  private async request(requestType: string, requestData?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const socket = await this.connect();
    const requestId = `obs-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`OBS request timed out: ${requestType}`));
      }, this.timeoutMs);

      socket.addEventListener("message", (event) => {
        const message = parseMessage(event.data);
        if (message.op !== 7 || message.d?.requestId !== requestId) return;
        clearTimeout(timer);
        socket.close();
        if (!message.d.requestStatus?.result) {
          reject(new Error(message.d.requestStatus?.comment ?? `OBS request failed: ${requestType}`));
          return;
        }
        resolve(message.d.responseData ?? {});
      });

      socket.addEventListener("error", (event) => {
        clearTimeout(timer);
        reject(new Error(`OBS socket error: ${String(event.error ?? "unknown")}`));
      });

      socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
    return result;
  }

  private async connect(): Promise<ObsSocket> {
    const url = this.status.url;
    if (!url) throw new Error("Missing OBS WebSocket URL.");
    const socket = this.createSocket(url);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("OBS WebSocket connection timed out."));
      }, this.timeoutMs);

      socket.addEventListener("message", (event) => {
        const message = parseMessage(event.data);
        if (message.op === 0) {
          const authentication =
            message.d?.authentication && (this.options.password ?? process.env.OBS_WEBSOCKET_PASSWORD)
              ? obsAuthentication(this.options.password ?? process.env.OBS_WEBSOCKET_PASSWORD ?? "", message.d.authentication.salt, message.d.authentication.challenge)
              : undefined;
          socket.send(JSON.stringify({ op: 1, d: { rpcVersion: message.d?.rpcVersion ?? 1, authentication } }));
        }
        if (message.op === 2) {
          clearTimeout(timer);
          resolve();
        }
      });

      socket.addEventListener("error", (event) => {
        clearTimeout(timer);
        reject(new Error(`OBS socket error: ${String(event.error ?? "unknown")}`));
      });
    });

    return socket;
  }

  private createSocket(url: string): ObsSocket {
    if (this.socketFactory) return this.socketFactory(url);
    const ctor = (globalThis as { WebSocket?: new (url: string) => ObsSocket }).WebSocket;
    if (!ctor) throw new Error("Global WebSocket is unavailable in this Node runtime.");
    return new ctor(url);
  }
}

function parseMessage(data: unknown): ObsRpcMessage {
  if (typeof data === "string") return JSON.parse(data) as ObsRpcMessage;
  if (data instanceof ArrayBuffer) return JSON.parse(Buffer.from(data).toString("utf8")) as ObsRpcMessage;
  if (ArrayBuffer.isView(data)) return JSON.parse(Buffer.from(data.buffer).toString("utf8")) as ObsRpcMessage;
  return JSON.parse(String(data)) as ObsRpcMessage;
}
