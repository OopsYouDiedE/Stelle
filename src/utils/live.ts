/**
 * 模块：Live runtime 与舞台桥接
 *
 * 运行逻辑：
 * - LiveCursor 通过工具层调用 LiveRuntime。
 * - LiveRuntime 维护当前舞台状态，并把 caption/motion/expression/background 命令发布给 renderer。
 * - OBS 控制目前是安全 stub：保留接口，不实际连接外部 OBS。
 *
 * 主要类：
 * - `LiveRuntime`：直播舞台状态和动作执行。
 * - `LocalLiveRendererBridge` / `HttpLiveRendererBridge`：向 renderer 发布命令。
 * - `ObsWebSocketController`：OBS 状态/控制接口占位。
 */
import type { LiveRendererCommand, LiveRendererServer } from "./renderer.js";
import { sanitizeExternalText } from "./text.js";

export type LiveMotionPriority = "idle" | "normal" | "force";

export interface LiveStageState {
  visible: boolean;
  background?: string;
  caption?: string;
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
  lastError?: string;

  constructor(url = process.env.LIVE_RENDERER_URL ?? "") {
    this.url = url.replace(/\/+$/, "");
  }

  async publish(command: LiveRendererCommand): Promise<void> {
    if (!this.url) return;
    try {
      const response = await fetch(`${this.url}/command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
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
    private readonly renderer?: LiveRendererBridge
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

  async playAudio(url: string, text?: string): Promise<LiveActionResult> {
    await this.renderer?.publish({ type: "audio:play", url, text: text ? sanitizeExternalText(text) : undefined });
    return liveOk(`Queued live audio playback: ${url}.`, this.stage);
  }

  async playTtsStream(text: string, request: Record<string, unknown>): Promise<LiveActionResult> {
    const id = `kokoro-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const url = `/tts/kokoro/${id}`;
    await this.renderer?.publish({ type: "audio:stream", url, provider: "kokoro", request, text: sanitizeExternalText(text) });
    return liveOk(`Queued live Kokoro stream playback: ${url}.`, this.stage);
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

  constructor(private readonly options: { enabled?: boolean; url?: string; password?: string; timeoutMs?: number } = {}) {
    this.status = {
      enabled: options.enabled ?? process.env.OBS_CONTROL_ENABLED === "true",
      connected: false,
      streaming: false,
      url: options.url ?? process.env.OBS_WEBSOCKET_URL ?? "ws://127.0.0.1:4455",
    };
  }

  async getStatus(): Promise<ObsStatus> {
    if (!this.status.enabled) return { ...this.status, connected: false };
    return { ...this.status, lastError: "OBS WebSocket control is not implemented in this runtime slice yet." };
  }

  async startStream(): Promise<LiveActionResult> {
    return obsUnavailable("OBS start is unavailable until OBS WebSocket is enabled.", this.status);
  }

  async stopStream(): Promise<LiveActionResult> {
    return obsUnavailable("OBS stop is unavailable until OBS WebSocket is enabled.", this.status);
  }

  async setCurrentScene(sceneName: string): Promise<LiveActionResult> {
    this.status = { ...this.status, currentScene: sceneName };
    return obsUnavailable("OBS scene control is unavailable until OBS WebSocket is enabled.", this.status);
  }
}

function liveOk(summary: string, stage: LiveStageState, obs?: ObsStatus): LiveActionResult {
  return { ok: true, summary, timestamp: Date.now(), stage: clone(stage), obs };
}

function liveFail(summary: string, code: string, stage: LiveStageState): LiveActionResult {
  return { ok: false, summary, timestamp: Date.now(), stage: clone(stage), error: { code, message: summary, retryable: false } };
}

function obsUnavailable(message: string, status: ObsStatus): LiveActionResult {
  return { ok: false, summary: message, timestamp: Date.now(), obs: { ...status }, error: { code: "obs_unavailable", message, retryable: true } };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
