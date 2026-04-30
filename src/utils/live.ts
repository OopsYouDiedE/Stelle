/**
 * 模块：Live runtime 与舞台桥接
 *
 * 运行逻辑：
 * - LiveCursor 通过工具层调用 LiveRuntime。
 * - LiveRuntime 维护当前舞台状态，并把 caption/motion/expression/background 命令发布给 renderer。
 * - OBS 控制通过 OBS WebSocket v5 执行状态读取、开播/停播与切场景。
 *
 * 主要类：
 * - `LiveRuntime`：直播舞台状态和动作执行。
 * - `LocalLiveRendererBridge` / `HttpLiveRendererBridge`：向 renderer 发布命令。
 * - `ObsWebSocketController`：OBS 状态/控制接口占位。
 */
import crypto from "node:crypto";
import type { LiveRendererCommand, LiveRendererServer } from "./renderer.js";
import { sanitizeExternalText } from "./text.js";
import { buildLiveTtsRequest } from "./tts.js";
import type { StelleEventBus } from "./event_bus.js";

export type LiveMotionPriority = "idle" | "normal" | "force";

export interface LiveStageState {
  visible: boolean;
  background?: string;
  caption?: string;
  speaker?: string;
  scene?: string;
  expression?: string;
  lastMotion?: {
    group: string;
    priority: LiveMotionPriority;
    triggeredAt: number;
  };
}

export interface ObsStatus {
  enabled: boolean;
  connected: boolean;
  streaming: boolean;
  currentScene?: string;
  url?: string;
  lastError?: string;
}

export interface LiveStatus {
  active: boolean;
  stage: LiveStageState;
  obs: ObsStatus;
}

export interface LiveActionResult {
  ok: boolean;
  summary: string;
  timestamp: number;
  stage?: LiveStageState;
  obs?: ObsStatus;
  error?: { code: string; message: string; retryable: boolean };
}

export interface LiveRendererBridge {
  publish(command: LiveRendererCommand): Promise<void> | void;
}

export class LocalLiveRendererBridge implements LiveRendererBridge {
  constructor(private readonly server: LiveRendererServer) {}

  publish(command: LiveRendererCommand): void {
    this.server.publish(command);
  }
}

export class HttpLiveRendererBridge implements LiveRendererBridge {
  readonly url: string;
  readonly controlToken: string;
  lastError?: string;

  constructor(
    url = process.env.LIVE_RENDERER_URL ?? "",
    options: { controlToken?: string } = {}
  ) {
    this.url = url.replace(/\/+$/, "");
    this.controlToken = options.controlToken ?? process.env.STELLE_CONTROL_TOKEN ?? process.env.STELLE_DEBUG_TOKEN ?? "";
  }

  async publish(command: LiveRendererCommand): Promise<void> {
    if (!this.url) return;
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (this.controlToken) {
        headers["authorization"] = `Bearer ${this.controlToken}`;
      }
      const response = await fetch(`${this.url}/command`, {
        method: "POST",
        headers,
        body: JSON.stringify(command),
      });
      if (!response.ok) throw new Error(`Renderer command failed: ${response.status} ${response.statusText}`);
      this.lastError = undefined;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }
}

export class LiveRuntime {
  private active = false;
  private stage: LiveStageState = { visible: true };

  constructor(
    readonly obs: ObsController = new ObsWebSocketController(),
    private readonly renderer?: LiveRendererBridge,
    private readonly eventBus?: StelleEventBus,
  ) {}

  async getStatus(): Promise<LiveStatus> {
    return { active: this.active, stage: clone(this.stage), obs: await this.obs.getStatus() };
  }

  async start(): Promise<LiveActionResult> {
    this.active = true;
    await this.renderer?.publish({ type: "state:set", state: clone(this.stage) });
    return liveOk("Live runtime active.", this.stage, await this.obs.getStatus());
  }

  async stop(): Promise<LiveActionResult> {
    this.active = false;
    return liveOk("Live runtime stopped.", this.stage, await this.obs.getStatus());
  }

  async triggerMotion(group: string, priority: LiveMotionPriority = "normal"): Promise<LiveActionResult> {
    this.stage = { ...this.stage, lastMotion: { group, priority, triggeredAt: Date.now() } };
    await this.renderer?.publish({ type: "motion:trigger", group, priority });
    return liveOk(`Triggered live motion ${group} (${priority}).`, this.stage);
  }

  async setExpression(expression: string): Promise<LiveActionResult> {
    this.stage = { ...this.stage, expression: sanitizeExternalText(expression) };
    await this.renderer?.publish({ type: "expression:set", expression: this.stage.expression });
    return liveOk(`Set live expression ${this.stage.expression}.`, this.stage);
  }

  async setCaption(text: string): Promise<LiveActionResult> {
    const caption = sanitizeExternalText(text);
    this.stage = { ...this.stage, caption };
    await this.renderer?.publish({ type: "caption:set", text: caption });
    return liveOk(`Updated live caption (${caption.length} chars).`, this.stage);
  }

  async streamCaption(text: string, speaker?: string, rateMs?: number): Promise<LiveActionResult> {
    const caption = sanitizeExternalText(text);
    this.stage = { ...this.stage, caption, speaker };
    await this.renderer?.publish({ type: "caption:stream", text: caption, speaker, rateMs });
    return liveOk(`Streaming live caption (${caption.length} chars).`, this.stage);
  }

  async showRouteDecision(input: { eventId: string; action: string; reason: string; text?: string; userName?: string }): Promise<LiveActionResult> {
    await this.renderer?.publish({ type: "route:decision", ...input });
    return liveOk(`Live route decision ${input.action} for ${input.eventId}.`, this.stage);
  }

  async pushEvent(input: {
    eventId?: string;
    lane: "incoming" | "response" | "topic" | "system";
    text: string;
    userName?: string;
    priority?: "low" | "medium" | "high";
    note?: string;
  }): Promise<LiveActionResult> {
    await this.renderer?.publish({
      type: "event:push",
      eventId: input.eventId,
      lane: input.lane,
      text: sanitizeExternalText(input.text),
      userName: input.userName ? sanitizeExternalText(input.userName) : undefined,
      priority: input.priority,
      note: input.note ? sanitizeExternalText(input.note) : undefined,
    });
    return liveOk(`Pushed live panel event for ${input.lane}.`, this.stage);
  }

  async clearCaption(): Promise<LiveActionResult> {
    this.stage = { ...this.stage, caption: undefined };
    await this.renderer?.publish({ type: "caption:clear" });
    return liveOk("Cleared live caption.", this.stage);
  }

  async setBackground(source: string): Promise<LiveActionResult> {
    this.stage = { ...this.stage, background: source };
    await this.renderer?.publish({ type: "background:set", source });
    return liveOk("Updated live background.", this.stage);
  }

  async updateTopic(state: unknown): Promise<LiveActionResult> {
    await this.renderer?.publish({ type: "topic:update", state });
    return liveOk("Updated live topic widget.", this.stage);
  }

  async updateWidget(widget: string, state: unknown): Promise<LiveActionResult> {
    await this.renderer?.publish({ type: "widget:update", widget, state });
    return liveOk(`Updated live widget ${widget}.`, this.stage);
  }

  async setSceneMode(scene: string, background?: string): Promise<LiveActionResult> {
    this.stage = { ...this.stage, scene: sanitizeExternalText(scene), background: background ?? this.stage.background };
    await this.renderer?.publish({ type: "scene:set", scene: this.stage.scene, background });
    return liveOk(`Set live scene mode ${this.stage.scene}.`, this.stage);
  }

  async playAudio(url: string, text?: string): Promise<LiveActionResult> {
    await this.renderer?.publish({ type: "audio:status", status: "queued", text: text ? sanitizeExternalText(text) : undefined });
    await this.renderer?.publish({ type: "audio:play", url, text: text ? sanitizeExternalText(text) : undefined });
    return liveOk(`Queued live audio playback: ${url}.`, this.stage);
  }

  async playTtsStream(text: string, request: Record<string, unknown>): Promise<LiveActionResult> {
    const caption = sanitizeExternalText(text);
    const speaker = typeof request.speaker === "string" ? sanitizeExternalText(request.speaker) : "Stelle";
    const rateMs = typeof request.rateMs === "number" ? request.rateMs : undefined;
    this.stage = { ...this.stage, caption, speaker };
    const liveTts = buildLiveTtsRequest(text, {
      voiceName: typeof request.voice === "string" ? request.voice : undefined,
      language: typeof request.language === "string" ? request.language : undefined,
      instructions: typeof request.instructions === "string" ? request.instructions : undefined,
      model: typeof request.model === "string" ? request.model : undefined,
      speed: typeof request.speed === "number" ? request.speed : undefined,
      stream: typeof request.stream === "boolean" ? request.stream : undefined,
    });
    const id = `${liveTts.provider}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const url = `/tts/${liveTts.provider}/${id}`;
    this.publishTtsStatus("queued", liveTts.provider, caption);
    await this.renderer?.publish({ type: "audio:status", status: "streaming", provider: liveTts.provider, text: caption });
    await this.renderer?.publish({ type: "audio:stream", url, provider: liveTts.provider, request: liveTts.request, text: caption, speaker, rateMs });
    this.publishTtsStatus("streaming", liveTts.provider, caption);
    return liveOk(`Queued live ${liveTts.provider} stream playback: ${url}.`, this.stage);
  }

  async stopAudio(): Promise<LiveActionResult> {
    await this.renderer?.publish({ type: "audio:status", status: "stopped" });
    await this.renderer?.publish({ type: "audio:stop" });
    this.publishTtsStatus("stopped");
    return liveOk("Stopped live audio.", this.stage);
  }

  private publishTtsStatus(status: string, provider?: string, text?: string): void {
    this.eventBus?.publish({
      type: "live.tts.status",
      source: "live_runtime",
      id: `live-tts-${status}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      payload: { status, provider, text },
    } as any);
  }
}

export interface ObsController {
  getStatus(): Promise<ObsStatus>;
  startStream(): Promise<LiveActionResult>;
  stopStream(): Promise<LiveActionResult>;
  setCurrentScene(sceneName: string): Promise<LiveActionResult>;
}

export class ObsWebSocketController implements ObsController {
  private status: ObsStatus;
  private readonly password?: string;
  private readonly timeoutMs: number;

  constructor(options: { enabled?: boolean; url?: string; password?: string; timeoutMs?: number } = {}) {
    this.password = options.password ?? process.env.OBS_WEBSOCKET_PASSWORD;
    this.timeoutMs = options.timeoutMs ?? 7000;
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
      const client = await ObsWebSocketClient.connect(this.status.url!, { password: this.password, timeoutMs: this.timeoutMs });
      try {
        const stream = await client.request("GetStreamStatus");
        const scene = await client.request("GetCurrentProgramScene").catch(() => ({}));
        this.status = {
          ...this.status,
          connected: true,
          streaming: Boolean((stream as any).outputActive),
          currentScene: typeof (scene as any).currentProgramSceneName === "string" ? (scene as any).currentProgramSceneName : this.status.currentScene,
          lastError: undefined,
        };
        return { ...this.status };
      } finally {
        client.close();
      }
    } catch (error) {
      this.status = { ...this.status, connected: false, lastError: error instanceof Error ? error.message : String(error) };
      return { ...this.status };
    }
  }

  async startStream(): Promise<LiveActionResult> {
    if (!this.status.enabled) return obsUnavailable("OBS WebSocket control is disabled.", this.status);
    return this.runObsAction("StartStream", undefined, "OBS stream started.");
  }

  async stopStream(): Promise<LiveActionResult> {
    if (!this.status.enabled) return obsUnavailable("OBS WebSocket control is disabled.", this.status);
    return this.runObsAction("StopStream", undefined, "OBS stream stopped.");
  }

  async setCurrentScene(sceneName: string): Promise<LiveActionResult> {
    if (!this.status.enabled) return obsUnavailable("OBS WebSocket control is disabled.", this.status);
    return this.runObsAction("SetCurrentProgramScene", { sceneName }, `OBS scene set to ${sceneName}.`);
  }

  private async runObsAction(requestType: string, requestData: Record<string, unknown> | undefined, summary: string): Promise<LiveActionResult> {
    try {
      const client = await ObsWebSocketClient.connect(this.status.url!, { password: this.password, timeoutMs: this.timeoutMs });
      try {
        await client.request(requestType, requestData);
      } finally {
        client.close();
      }
      const status = await this.getStatus();
      return { ok: true, summary, timestamp: Date.now(), obs: status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = { ...this.status, connected: false, lastError: message };
      return obsUnavailable(message, this.status);
    }
  }
}

class ObsWebSocketClient {
  private requestCounter = 0;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  private constructor(
    private readonly ws: any,
    private readonly timeoutMs: number,
  ) {
    ws.onmessage = (event: { data: string }) => this.handleMessage(event.data);
    ws.onerror = () => this.rejectAll(new Error("OBS websocket error."));
    ws.onclose = () => this.rejectAll(new Error("OBS websocket closed."));
  }

  static connect(url: string, options: { password?: string; timeoutMs: number }): Promise<ObsWebSocketClient> {
    const WebSocketCtor = (globalThis as any).WebSocket;
    if (!WebSocketCtor) return Promise.reject(new Error("Global WebSocket is unavailable. Use Node.js >= 20."));

    return new Promise((resolve, reject) => {
      const ws = new WebSocketCtor(url);
      const timeout = setTimeout(() => reject(new Error("OBS websocket connection timed out.")), options.timeoutMs);
      let client: ObsWebSocketClient | undefined;

      ws.onopen = () => undefined;
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("OBS websocket connection failed."));
      };
      ws.onmessage = async (event: { data: string }) => {
        try {
          const message = JSON.parse(event.data);
          if (message.op !== 0) return;
          const authentication = message.d?.authentication;
          const identify: Record<string, unknown> = { rpcVersion: 1 };
          if (authentication) {
            if (!options.password) throw new Error("OBS websocket password is required.");
            identify.authentication = obsAuth(options.password, authentication.salt, authentication.challenge);
          }
          ws.send(JSON.stringify({ op: 1, d: identify }));
          ws.onmessage = (identifiedEvent: { data: string }) => {
            const identified = JSON.parse(identifiedEvent.data);
            if (identified.op !== 2) return;
            clearTimeout(timeout);
            if (!client) client = new ObsWebSocketClient(ws, options.timeoutMs);
            ws.onmessage = (runtimeEvent: { data: string }) => client!.handleMessage(runtimeEvent.data);
            resolve(client);
          };
        } catch (error) {
          clearTimeout(timeout);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
    });
  }

  request(requestType: string, requestData: Record<string, unknown> = {}): Promise<unknown> {
    const requestId = `stelle-${Date.now()}-${++this.requestCounter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`OBS request timed out: ${requestType}.`));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // best effort
    }
  }

  private handleMessage(raw: string): void {
    const message = JSON.parse(raw);
    if (message.op !== 7) return;
    const requestId = message.d?.requestId;
    const pending = typeof requestId === "string" ? this.pending.get(requestId) : undefined;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);

    const status = message.d?.requestStatus;
    if (!status?.result) {
      pending.reject(new Error(status?.comment || `OBS request failed: ${status?.code ?? "unknown"}`));
      return;
    }
    pending.resolve(message.d?.responseData ?? {});
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

function obsAuth(password: string, salt: string, challenge: string): string {
  const secret = crypto.createHash("sha256").update(password + salt).digest("base64");
  return crypto.createHash("sha256").update(secret + challenge).digest("base64");
}

function liveOk(summary: string, stage: LiveStageState, obs?: ObsStatus): LiveActionResult {
  return { ok: true, summary, timestamp: Date.now(), stage: clone(stage), obs };
}

function obsUnavailable(message: string, status: ObsStatus): LiveActionResult {
  return { ok: false, summary: message, timestamp: Date.now(), obs: { ...status }, error: { code: "obs_unavailable", message, retryable: true } };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
