import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { HttpLiveRendererBridge } from "./renderer/LiveRendererServer.js";
import { sanitizeExternalText } from "../TextStream.js";

function now(): number {
  return Date.now();
}

function cloneStage(stage: Live2DStageState): Live2DStageState {
  return {
    ...stage,
    model: stage.model ? { ...stage.model, motions: { ...stage.model.motions }, hitAreas: { ...stage.model.hitAreas } } : undefined,
    lastMotion: stage.lastMotion ? { ...stage.lastMotion } : undefined,
    drag: stage.drag ? { ...stage.drag } : undefined,
    lastInteraction: stage.lastInteraction ? { ...stage.lastInteraction } : undefined,
  };
}

function action(summary: string, stage: Live2DStageState, obs?: ObsStatus): LiveActionResult {
  return { ok: true, summary, timestamp: now(), stage: cloneStage(stage), obs };
}

function defaultRenderer(): LiveRendererBridge | undefined {
  return process.env.LIVE_RENDERER_URL ? new HttpLiveRendererBridge(process.env.LIVE_RENDERER_URL) : undefined;
}

function kokoroStreamRequest(
  text: string,
  options: { voiceName?: string; speed?: number; language?: string; responseFormat?: string }
) {
  const voice = options.voiceName ?? process.env.KOKORO_TTS_VOICE ?? "zf_xiaobei";
  const language = options.language ?? (voice.startsWith("z") ? process.env.KOKORO_TTS_LANGUAGE : undefined);
  return {
    model: process.env.KOKORO_TTS_MODEL ?? "kokoro",
    input: text,
    voice,
    response_format:
      options.responseFormat ??
      process.env.KOKORO_TTS_STREAM_RESPONSE_FORMAT ??
      process.env.KOKORO_TTS_RESPONSE_FORMAT ??
      "wav",
    stream: true,
    ...(typeof options.speed === "number" ? { speed: options.speed } : {}),
    ...(language ? { language } : {}),
  };
}

export class LiveRuntime {
  private active = false;
  private stage: Live2DStageState = {
    visible: true,
  };
  private eventSink?: LiveRuntimeEventSink;

  constructor(
    readonly models: Live2DModelRegistry = new Live2DModelRegistry(),
    readonly obs: ObsController = new ObsWebSocketController(),
    private readonly renderer: LiveRendererBridge | undefined = defaultRenderer()
  ) {
    this.stage.model = models.getDefault();
  }

  setEventSink(sink?: LiveRuntimeEventSink): void {
    this.eventSink = sink;
  }

  async getStatus(): Promise<LiveRuntimeStatus> {
    return {
      active: this.active,
      stage: cloneStage(this.stage),
      obs: await this.obs.getStatus(),
    };
  }

  async start(): Promise<LiveActionResult> {
    this.active = true;
    if (!this.stage.model) this.stage.model = this.models.getDefault();
    await this.renderer?.publish({ type: "state:set", state: cloneStage(this.stage) });
    const result = action(`Live runtime active with ${this.stage.model.displayName}.`, this.stage, await this.obs.getStatus());
    this.emitEvent({ action: "start_live", ok: result.ok, summary: result.summary, timestamp: result.timestamp, stage: result.stage, obs: result.obs });
    return result;
  }

  async stop(): Promise<LiveActionResult> {
    this.active = false;
    const result = action("Live runtime stopped.", this.stage, await this.obs.getStatus());
    this.emitEvent({ action: "stop_live", ok: result.ok, summary: result.summary, timestamp: result.timestamp, stage: result.stage, obs: result.obs });
    return result;
  }

  async loadModel(modelId: string): Promise<LiveActionResult> {
    const model = this.models.get(modelId);
    if (!model) {
      return {
        ok: false,
        summary: `Live2D model is not registered: ${modelId}.`,
        timestamp: now(),
        stage: cloneStage(this.stage),
        error: {
          code: "live2d_model_missing",
          message: `Live2D model is not registered: ${modelId}.`,
          retryable: false,
        },
      };
    }
    this.stage = { ...this.stage, model, lastMotion: undefined, expression: undefined };
    await this.renderer?.publish({ type: "model:load", modelId, model });
    const result = action(`Loaded Live2D model ${model.displayName}.`, this.stage);
    this.emitEvent({
      action: "load_model",
      ok: result.ok,
      summary: result.summary,
      timestamp: result.timestamp,
      stage: result.stage,
      metadata: { modelId, displayName: model.displayName },
    });
    return result;
  }

  async triggerMotion(group: string, priority: Live2DMotionPriority = "normal"): Promise<LiveActionResult> {
    this.stage = {
      ...this.stage,
      lastMotion: {
        group,
        priority,
        triggeredAt: now(),
      },
    };
    await this.renderer?.publish({ type: "motion:trigger", group, priority });
    const result = action(`Triggered Live2D motion ${group} (${priority}).`, this.stage);
    this.emitEvent({
      action: "trigger_motion",
      ok: result.ok,
      summary: result.summary,
      timestamp: result.timestamp,
      stage: result.stage,
      metadata: { group, priority },
    });
    return result;
  }

  async setExpression(expression: string): Promise<LiveActionResult> {
    this.stage = { ...this.stage, expression };
    await this.renderer?.publish({ type: "expression:set", expression });
    const result = action(`Set Live2D expression ${expression}.`, this.stage);
    this.emitEvent({
      action: "set_expression",
      ok: result.ok,
      summary: result.summary,
      timestamp: result.timestamp,
      stage: result.stage,
      metadata: { expression },
    });
    return result;
  }

  async setCaption(text: string): Promise<LiveActionResult> {
    const caption = sanitizeExternalText(text);
    this.stage = { ...this.stage, caption };
    await this.renderer?.publish({ type: "caption:set", text: caption });
    const result = action(`Updated live caption (${caption.length} chars).`, this.stage);
    this.emitEvent({
      action: "set_caption",
      ok: result.ok,
      summary: result.summary,
      timestamp: result.timestamp,
      stage: result.stage,
      text: caption,
    });
    return result;
  }

  async clearCaption(): Promise<LiveActionResult> {
    this.stage = { ...this.stage, caption: undefined };
    await this.renderer?.publish({ type: "caption:clear" });
    const result = action("Cleared live caption.", this.stage);
    this.emitEvent({ action: "clear_caption", ok: result.ok, summary: result.summary, timestamp: result.timestamp, stage: result.stage });
    return result;
  }

  async setBackground(source: string): Promise<LiveActionResult> {
    this.stage = { ...this.stage, background: source };
    await this.renderer?.publish({ type: "background:set", source });
    const result = action("Updated live background.", this.stage);
    this.emitEvent({
      action: "set_background",
      ok: result.ok,
      summary: result.summary,
      timestamp: result.timestamp,
      stage: result.stage,
      metadata: { source },
    });
    return result;
  }

  async setMouth(value: number): Promise<LiveActionResult> {
    const mouth = Math.max(0, Math.min(1, value));
    await this.renderer?.publish({ type: "mouth:set", value: mouth });
    const result = action(`Set Live2D mouth value ${mouth}.`, this.stage);
    this.emitEvent({
      action: "set_mouth",
      ok: result.ok,
      summary: result.summary,
      timestamp: result.timestamp,
      stage: result.stage,
      metadata: { value: mouth },
    });
    return result;
  }

  async startSpeech(durationMs = 2400): Promise<LiveActionResult> {
    await this.renderer?.publish({ type: "speech:start", durationMs });
    const result = action(`Started Live2D speech lip sync for ${durationMs}ms.`, this.stage);
    this.emitEvent({
      action: "start_speech",
      ok: result.ok,
      summary: result.summary,
      timestamp: result.timestamp,
      stage: result.stage,
      metadata: { durationMs },
    });
    return result;
  }

  async stopSpeech(): Promise<LiveActionResult> {
    await this.renderer?.publish({ type: "speech:stop" });
    const result = action("Stopped Live2D speech lip sync.", this.stage);
    this.emitEvent({ action: "stop_speech", ok: result.ok, summary: result.summary, timestamp: result.timestamp, stage: result.stage });
    return result;
  }

  async playAudio(url: string, text?: string): Promise<LiveActionResult> {
    await this.renderer?.publish({ type: "audio:play", url, text: text === undefined ? undefined : sanitizeExternalText(text) });
    const result = action(`Queued live audio playback: ${url}.`, this.stage);
    this.emitEvent({
      action: "play_audio",
      ok: result.ok,
      summary: result.summary,
      timestamp: result.timestamp,
      stage: result.stage,
      text: text === undefined ? undefined : sanitizeExternalText(text),
      metadata: { url },
    });
    return result;
  }

  async playTtsStream(
    text: string,
    options: { voiceName?: string; speed?: number; language?: string; responseFormat?: string } = {}
  ): Promise<LiveActionResult> {
    const speechText = sanitizeExternalText(text);
    const id = `kokoro-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const url = `/tts/kokoro/${id}`;
    await this.renderer?.publish({
      type: "audio:stream",
      url,
      text: speechText,
      provider: "kokoro",
      request: kokoroStreamRequest(speechText, options),
    });
    const result = action(`Queued live Kokoro stream playback: ${url}.`, this.stage);
    this.emitEvent({
      action: "play_tts_stream",
      ok: result.ok,
      summary: result.summary,
      timestamp: result.timestamp,
      stage: result.stage,
      text: speechText,
      source: "kokoro",
      metadata: { url },
    });
    return result;
  }

  async setDrag(x: number, y: number): Promise<LiveActionResult> {
    this.stage = {
      ...this.stage,
      drag: { x, y },
      lastInteraction: { kind: "drag", x, y, timestamp: now() },
    };
    const result = action(`Updated Live2D drag target (${x}, ${y}).`, this.stage);
    this.emitEvent({
      action: "set_drag",
      ok: result.ok,
      summary: result.summary,
      timestamp: result.timestamp,
      stage: result.stage,
      metadata: { x, y },
    });
    return result;
  }

  async tap(x: number, y: number): Promise<LiveActionResult> {
    const group = this.stage.model?.motions.tap ?? this.stage.model?.motions.tapBody ?? "Tap";
    this.stage = {
      ...this.stage,
      lastInteraction: { kind: "tap", x, y, timestamp: now() },
      lastMotion: { group, priority: "normal", triggeredAt: now() },
    };
    const result = action(`Registered Live2D tap and triggered ${group}.`, this.stage);
    this.emitEvent({
      action: "tap",
      ok: result.ok,
      summary: result.summary,
      timestamp: result.timestamp,
      stage: result.stage,
      metadata: { x, y, group },
    });
    return result;
  }

  async flick(dx: number, dy: number, x: number, y: number): Promise<LiveActionResult> {
    const motions = this.stage.model?.motions;
    const group =
      Math.abs(dx) >= Math.abs(dy)
        ? motions?.flick ?? "Flick"
        : dy > 0
          ? motions?.flickUp ?? motions?.flick ?? "FlickUp"
          : motions?.flickDown ?? motions?.flick ?? "FlickDown";
    this.stage = {
      ...this.stage,
      lastInteraction: { kind: "flick", x, y, dx, dy, timestamp: now() },
      lastMotion: { group, priority: "normal", triggeredAt: now() },
    };
    const result = action(`Registered Live2D flick and triggered ${group}.`, this.stage);
    this.emitEvent({
      action: "flick",
      ok: result.ok,
      summary: result.summary,
      timestamp: result.timestamp,
      stage: result.stage,
      metadata: { dx, dy, x, y, group },
    });
    return result;
  }

  private emitEvent(event: Parameters<NonNullable<LiveRuntimeEventSink>>[0]): void {
    void this.eventSink?.(event);
  }
}

export type Live2DMotionPriority = "idle" | "normal" | "force";

export interface Live2DModelConfig {
  id: string;
  displayName: string;
  dir: string;
  jsonName: string;
  resourcesRoot: string;
  modelJsonPath?: string;
  motions: {
    idle?: string;
    tap?: string;
    tapBody?: string;
    flick?: string;
    flickUp?: string;
    flickDown?: string;
    flickBody?: string;
  };
  hitAreas: {
    head?: string;
    body?: string;
  };
}

export interface Live2DStageState {
  model?: Live2DModelConfig;
  visible: boolean;
  background?: string;
  caption?: string;
  expression?: string;
  lastMotion?: {
    group: string;
    priority: Live2DMotionPriority;
    triggeredAt: number;
  };
  drag?: {
    x: number;
    y: number;
  };
  lastInteraction?: {
    kind: "tap" | "flick" | "drag";
    x: number;
    y: number;
    dx?: number;
    dy?: number;
    timestamp: number;
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

export interface LiveRuntimeStatus {
  active: boolean;
  stage: Live2DStageState;
  obs: ObsStatus;
}

export interface LiveRendererAudioStatus {
  queued: number;
  playing: boolean;
  playedCount: number;
  activated: boolean;
  updatedAt: number;
  lastUrl?: string;
  lastText?: string;
  lastEvent?: string;
  lastError?: string;
  errorName?: string;
  mediaErrorCode?: number;
  mediaErrorMessage?: string;
}

export interface LiveActionResult {
  ok: boolean;
  summary: string;
  timestamp: number;
  stage?: Live2DStageState;
  obs?: ObsStatus;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface LiveRuntimeEvent {
  action: string;
  ok: boolean;
  summary: string;
  timestamp: number;
  text?: string;
  source?: string;
  stage?: Live2DStageState;
  obs?: ObsStatus;
  metadata?: Record<string, unknown>;
}

export type LiveRuntimeEventSink = (event: LiveRuntimeEvent) => void | Promise<void>;

export interface ObsController {
  getStatus(): Promise<ObsStatus>;
  startStream(): Promise<LiveActionResult>;
  stopStream(): Promise<LiveActionResult>;
  setCurrentScene(sceneName: string): Promise<LiveActionResult>;
}

export type LiveRendererCommand =
  | { type: "state:set"; state: Live2DStageState }
  | { type: "caption:set"; text: string }
  | { type: "caption:clear" }
  | { type: "background:set"; source: string }
  | { type: "model:load"; modelId: string; model?: Live2DModelConfig }
  | { type: "motion:trigger"; group: string; priority: Live2DMotionPriority }
  | { type: "expression:set"; expression: string }
  | { type: "mouth:set"; value: number }
  | { type: "speech:start"; durationMs?: number }
  | { type: "speech:stop" }
  | { type: "audio:play"; url: string; text?: string }
  | {
      type: "audio:stream";
      url: string;
      text?: string;
      provider: "kokoro";
      request: Record<string, string | number | boolean>;
    };

export interface LiveRendererBridge {
  publish(command: LiveRendererCommand): Promise<void> | void;
}

function defaultResourcesRoot(): string {
  return path.resolve(process.env.LIVE2D_RESOURCES_ROOT ?? "assets/live2d/public/Resources");
}

export function createHiyoriModelConfigs(resourcesRoot = defaultResourcesRoot()): Live2DModelConfig[] {
  return [
    {
      id: "Hiyori",
      displayName: "Hiyori",
      dir: "Hiyori",
      jsonName: "Hiyori.model3.json",
      resourcesRoot,
      modelJsonPath: path.join(resourcesRoot, "Hiyori", "Hiyori.model3.json"),
      motions: {
        idle: "Idle",
        tapBody: "TapBody",
      },
      hitAreas: {
        body: "Body",
      },
    },
    {
      id: "Hiyori_pro",
      displayName: "Hiyori Pro",
      dir: "Hiyori_pro",
      jsonName: "hiyori_pro_t11.model3.json",
      resourcesRoot,
      modelJsonPath: path.join(resourcesRoot, "Hiyori_pro", "hiyori_pro_t11.model3.json"),
      motions: {
        idle: "Idle",
        tap: "Tap",
        tapBody: "Tap@Body",
        flick: "Flick",
        flickUp: "FlickUp",
        flickDown: "FlickDown",
        flickBody: "Flick@Body",
      },
      hitAreas: {
        body: "Body",
      },
    },
  ];
}

export class Live2DModelRegistry {
  private readonly models = new Map<string, Live2DModelConfig>();

  constructor(models: Live2DModelConfig[] = createHiyoriModelConfigs()) {
    for (const model of models) {
      this.models.set(model.id, model);
    }
  }

  list(): Live2DModelConfig[] {
    return [...this.models.values()].map((model) => ({ ...model, motions: { ...model.motions }, hitAreas: { ...model.hitAreas } }));
  }

  get(id: string): Live2DModelConfig | undefined {
    const model = this.models.get(id);
    return model ? { ...model, motions: { ...model.motions }, hitAreas: { ...model.hitAreas } } : undefined;
  }

  getDefault(): Live2DModelConfig {
    const preferred = process.env.LIVE2D_DEFAULT_MODEL ?? "Hiyori_pro";
    return this.get(preferred) ?? this.list()[0]!;
  }

  async checkAssets(id: string): Promise<{ ok: boolean; model?: Live2DModelConfig; missing?: string[] }> {
    const model = this.get(id);
    if (!model) return { ok: false, missing: [`model:${id}`] };
    const modelJsonPath = model.modelJsonPath ?? path.join(model.resourcesRoot, model.dir, model.jsonName);
    try {
      await fs.access(modelJsonPath);
      return { ok: true, model: { ...model, modelJsonPath } };
    } catch {
      return { ok: false, model: { ...model, modelJsonPath }, missing: [modelJsonPath] };
    }
  }
}

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

function obsNow(): number {
  return Date.now();
}

function obsOk(summary: string, obs: ObsStatus): LiveActionResult {
  return { ok: true, summary, timestamp: obsNow(), obs };
}

function obsUnavailable(message: string, status: ObsStatus): LiveActionResult {
  return {
    ok: false,
    summary: message,
    timestamp: obsNow(),
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
    if (!this.status.enabled) return obsUnavailable("OBS control is disabled.", { ...this.status });
    try {
      await this.request("StartStream");
      this.status = { ...this.status, connected: true, streaming: true, lastError: undefined };
      return obsOk("OBS streaming started.", { ...this.status });
    } catch (error) {
      return this.fail(error);
    }
  }

  async stopStream(): Promise<LiveActionResult> {
    if (!this.status.enabled) return obsUnavailable("OBS control is disabled.", { ...this.status });
    try {
      await this.request("StopStream");
      this.status = { ...this.status, connected: true, streaming: false, lastError: undefined };
      return obsOk("OBS streaming stopped.", { ...this.status });
    } catch (error) {
      return this.fail(error);
    }
  }

  async setCurrentScene(sceneName: string): Promise<LiveActionResult> {
    if (!this.status.enabled) return obsUnavailable("OBS control is disabled.", { ...this.status });
    try {
      await this.request("SetCurrentProgramScene", { sceneName });
      this.status = { ...this.status, connected: true, currentScene: sceneName, lastError: undefined };
      return obsOk(`OBS scene set to ${sceneName}.`, { ...this.status });
    } catch (error) {
      return this.fail(error);
    }
  }

  private fail(error: unknown): LiveActionResult {
    const message = error instanceof Error ? error.message : String(error);
    this.status = { ...this.status, connected: false, lastError: message };
    return obsUnavailable(message, { ...this.status });
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
        const message = parseObsMessage(event.data);
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
        const message = parseObsMessage(event.data);
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

function parseObsMessage(data: unknown): ObsRpcMessage {
  if (typeof data === "string") return JSON.parse(data) as ObsRpcMessage;
  if (data instanceof ArrayBuffer) return JSON.parse(Buffer.from(data).toString("utf8")) as ObsRpcMessage;
  if (ArrayBuffer.isView(data)) return JSON.parse(Buffer.from(data.buffer).toString("utf8")) as ObsRpcMessage;
  return JSON.parse(String(data)) as ObsRpcMessage;
}
