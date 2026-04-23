import type {
  Live2DModelConfig,
  Live2DMotionPriority,
  Live2DStageState,
  LiveActionResult,
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

export class LiveRuntime {
  private active = false;
  private stage: Live2DStageState = {
    visible: true,
  };

  constructor(
    readonly models: Live2DModelRegistry = new Live2DModelRegistry(),
    readonly obs: ObsController = new ObsWebSocketController(),
    private readonly renderer: LiveRendererBridge | undefined = defaultRenderer()
  ) {
    this.stage.model = models.getDefault();
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
    return action(`Live runtime active with ${this.stage.model.displayName}.`, this.stage, await this.obs.getStatus());
  }

  async stop(): Promise<LiveActionResult> {
    this.active = false;
    return action("Live runtime stopped.", this.stage, await this.obs.getStatus());
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
    return action(`Loaded Live2D model ${model.displayName}.`, this.stage);
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
    return action(`Triggered Live2D motion ${group} (${priority}).`, this.stage);
  }

  async setExpression(expression: string): Promise<LiveActionResult> {
    this.stage = { ...this.stage, expression };
    await this.renderer?.publish({ type: "expression:set", expression });
    return action(`Set Live2D expression ${expression}.`, this.stage);
  }

  async setCaption(text: string): Promise<LiveActionResult> {
    const caption = sanitizeExternalText(text);
    this.stage = { ...this.stage, caption };
    await this.renderer?.publish({ type: "caption:set", text: caption });
    return action(`Updated live caption (${caption.length} chars).`, this.stage);
  }

  async clearCaption(): Promise<LiveActionResult> {
    this.stage = { ...this.stage, caption: undefined };
    await this.renderer?.publish({ type: "caption:clear" });
    return action("Cleared live caption.", this.stage);
  }

  async setBackground(source: string): Promise<LiveActionResult> {
    this.stage = { ...this.stage, background: source };
    await this.renderer?.publish({ type: "background:set", source });
    return action("Updated live background.", this.stage);
  }

  async setMouth(value: number): Promise<LiveActionResult> {
    const mouth = Math.max(0, Math.min(1, value));
    await this.renderer?.publish({ type: "mouth:set", value: mouth });
    return action(`Set Live2D mouth value ${mouth}.`, this.stage);
  }

  async startSpeech(durationMs = 2400): Promise<LiveActionResult> {
    await this.renderer?.publish({ type: "speech:start", durationMs });
    return action(`Started Live2D speech lip sync for ${durationMs}ms.`, this.stage);
  }

  async stopSpeech(): Promise<LiveActionResult> {
    await this.renderer?.publish({ type: "speech:stop" });
    return action("Stopped Live2D speech lip sync.", this.stage);
  }

  async playAudio(url: string, text?: string): Promise<LiveActionResult> {
    await this.renderer?.publish({ type: "audio:play", url, text: text === undefined ? undefined : sanitizeExternalText(text) });
    return action(`Queued live audio playback: ${url}.`, this.stage);
  }

  async playTtsStream(
    text: string,
    options: { voiceName?: string; speed?: number; language?: string; responseFormat?: string } = {}
  ): Promise<LiveActionResult> {
    const speechText = sanitizeExternalText(text);
    const voice = options.voiceName ?? process.env.KOKORO_TTS_VOICE ?? "zf_xiaobei";
    const language = options.language ?? (voice.startsWith("z") ? process.env.KOKORO_TTS_LANGUAGE : undefined);
    const responseFormat =
      options.responseFormat ?? process.env.KOKORO_TTS_STREAM_RESPONSE_FORMAT ?? process.env.KOKORO_TTS_RESPONSE_FORMAT ?? "wav";
    const id = `kokoro-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const request = {
      model: process.env.KOKORO_TTS_MODEL ?? "kokoro",
      input: speechText,
      voice,
      response_format: responseFormat,
      stream: true,
      ...(typeof options.speed === "number" ? { speed: options.speed } : {}),
      ...(language ? { language } : {}),
    };
    const url = `/tts/kokoro/${id}`;
    await this.renderer?.publish({
      type: "audio:stream",
      url,
      text: speechText,
      provider: "kokoro",
      request,
    });
    return action(`Queued live Kokoro stream playback: ${url}.`, this.stage);
  }

  async setDrag(x: number, y: number): Promise<LiveActionResult> {
    this.stage = {
      ...this.stage,
      drag: { x, y },
      lastInteraction: { kind: "drag", x, y, timestamp: now() },
    };
    return action(`Updated Live2D drag target (${x}, ${y}).`, this.stage);
  }

  async tap(x: number, y: number): Promise<LiveActionResult> {
    const group = this.stage.model?.motions.tap ?? this.stage.model?.motions.tapBody ?? "Tap";
    this.stage = {
      ...this.stage,
      lastInteraction: { kind: "tap", x, y, timestamp: now() },
      lastMotion: { group, priority: "normal", triggeredAt: now() },
    };
    return action(`Registered Live2D tap and triggered ${group}.`, this.stage);
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
    return action(`Registered Live2D flick and triggered ${group}.`, this.stage);
  }
}
