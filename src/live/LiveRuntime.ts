import type {
  Live2DModelConfig,
  Live2DMotionPriority,
  Live2DStageState,
  LiveActionResult,
  LiveRuntimeEventSink,
  LiveRuntimeStatus,
  LiveRendererBridge,
  ObsController,
  ObsStatus,
} from "./types.js";
import { Live2DModelRegistry } from "./Live2DModelRegistry.js";
import { ObsWebSocketController } from "./ObsWebSocketController.js";
import { HttpLiveRendererBridge } from "./renderer/HttpLiveRendererBridge.js";
import { sanitizeExternalText } from "../text/sanitize.js";

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
