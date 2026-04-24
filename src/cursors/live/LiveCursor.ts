import type {
  ContextStreamItem,
  CursorConfig,
  CursorPolicy,
  CursorReport,
  CursorToolNamespace,
} from "../../types.js";
import { AsyncConfigStore } from "../../config/AsyncConfigStore.js";
import { BaseCursor } from "../BaseCursor.js";
import { LiveRuntime } from "../../live/LiveRuntime.js";
import { KokoroTtsProvider } from "../../tts/KokoroTtsProvider.js";
import type { StreamingTtsProvider } from "../../tts/types.js";

function now(): number {
  return Date.now();
}

export interface LiveSpeechQueueItem {
  id: string;
  text: string;
  source: string;
  enqueuedAt: number;
}

const livePolicy: CursorPolicy = {
  allowPassiveResponse: true,
  allowBackgroundTick: true,
  allowInitiativeWhenAttached: false,
  passiveResponseRisk: "low",
  escalationRules: [
    {
      id: "live.external_broadcast",
      summary: "OBS streaming and public stage changes are Stelle-level actions.",
      severity: "warning",
    },
  ],
};

export class LiveCursor extends BaseCursor {
  private readonly speechQueue: LiveSpeechQueueItem[] = [];

  constructor(
    readonly live: LiveRuntime = new LiveRuntime(),
    options?: { id?: string; configStore?: AsyncConfigStore<CursorConfig>; ttsProvider?: StreamingTtsProvider }
  ) {
    const id = options?.id ?? "live";
    super(
      { id, kind: "live", displayName: "Live Cursor", version: "0.1.0" },
      livePolicy,
      {
        cursorId: id,
        version: "0.1.0",
        behavior: {
          model: process.env.LIVE2D_DEFAULT_MODEL ?? "Hiyori_pro",
        },
        runtime: {
          resourcesRoot: process.env.LIVE2D_RESOURCES_ROOT ?? "assets/live2d/public/Resources",
          obsUrl: process.env.OBS_WEBSOCKET_URL ?? "ws://127.0.0.1:4455",
        },
        permissions: {
          obsControl: process.env.OBS_CONTROL_ENABLED === "true",
        },
        updatedAt: now(),
      },
      options?.configStore
    );
    this.ttsProvider = options?.ttsProvider;
    this.stream.push(this.liveEvent("Live Cursor initialized with Live2D/OBS runtime boundary."));
  }

  private readonly ttsProvider?: StreamingTtsProvider;

  getToolNamespace(): CursorToolNamespace {
    return {
      cursorId: this.identity.id,
      namespaces: ["live"],
      tools: [
        {
          namespace: "live",
          name: "cursor_status",
          authorityClass: "cursor",
          summary: "Read Live2D stage and OBS status.",
          authorityHint: "read-only cursor tool",
        },
        {
          namespace: "live",
          name: "cursor_get_stage",
          authorityClass: "cursor",
          summary: "Read current Live2D stage state.",
          authorityHint: "read-only cursor tool",
        },
        {
          namespace: "live",
          name: "cursor_set_caption_preview",
          authorityClass: "cursor",
          summary: "Update local caption preview in the Live Cursor state.",
          authorityHint: "low-risk local preview state",
        },
      ],
    };
  }

  override async observe() {
    const base = await super.observe();
    const status = await this.live.getStatus();
    const stateItem: ContextStreamItem = {
      id: `live-state-${now()}`,
      type: "state",
      source: this.identity.id,
      timestamp: now(),
      content: [
        `Live active=${status.active}; model=${status.stage.model?.displayName ?? "none"}; visible=${status.stage.visible}`,
        status.stage.lastMotion ? `lastMotion=${status.stage.lastMotion.group}` : undefined,
        status.stage.caption ? `caption=${status.stage.caption}` : undefined,
        `OBS enabled=${status.obs.enabled}; connected=${status.obs.connected}; streaming=${status.obs.streaming}`,
      ].filter(Boolean).join("\n"),
      trust: "cursor",
      metadata: {
        liveState: true,
        active: status.active,
        modelId: status.stage.model?.id,
        obsEnabled: status.obs.enabled,
        obsStreaming: status.obs.streaming,
      },
    };
    return {
      ...base,
      stream: [...base.stream, stateItem].slice(-20),
      stateSummary: `${base.stateSummary} Live model=${status.stage.model?.id ?? "none"}, OBS streaming=${status.obs.streaming}.`,
    };
  }

  async startLive(): Promise<CursorReport> {
    const result = await this.live.start();
    this.state = {
      ...this.state,
      status: result.ok ? "active" : "degraded",
      summary: result.summary,
      lastInputAt: now(),
    };
    this.stream.push(this.liveEvent(result.summary));
    return this.report("live_started", result.ok ? "info" : "warning", result.summary, !result.ok, { result });
  }

  async stopLive(): Promise<CursorReport> {
    const result = await this.live.stop();
    this.state = {
      ...this.state,
      status: this.state.attached ? "active" : "idle",
      summary: result.summary,
      lastInputAt: now(),
    };
    this.stream.push(this.liveEvent(result.summary));
    return this.report("live_stopped", "info", result.summary, false, { result });
  }

  async tick(): Promise<CursorReport[]> {
    const reports: CursorReport[] = [];
    const nextSpeech = this.speechQueue.shift();
    if (nextSpeech) {
      const caption = await this.live.setCaption(nextSpeech.text);
      await this.speakQueuedSpeech(nextSpeech.text, nextSpeech.id);
      this.stream.push(this.liveEvent(`Live speech queue played ${nextSpeech.id}: ${caption.summary}`));
      reports.push(
        this.report("live_speech_queue_played", "info", `Played queued live speech ${nextSpeech.id}.`, false, {
          item: nextSpeech,
          remaining: this.speechQueue.length,
        })
      );
    }

    const status = await this.live.getStatus();
    this.state = {
      ...this.state,
      status: status.obs.enabled && !status.obs.connected ? "degraded" : this.state.status,
      summary: status.obs.lastError ? `Live runtime degraded: ${status.obs.lastError}` : this.state.summary,
      lastReportAt: now(),
    };
    reports.push(
      this.report("live_health", status.obs.lastError ? "warning" : "debug", `OBS streaming=${status.obs.streaming}`, Boolean(status.obs.lastError), {
        obs: status.obs,
        stage: status.stage,
        speechQueueLength: this.speechQueue.length,
      })
    );
    return reports;
  }

  private async speakQueuedSpeech(text: string, filePrefix: string): Promise<void> {
    if (process.env.LIVE_TTS_ENABLED !== "true") return undefined;
    const provider = this.ttsProvider ?? new KokoroTtsProvider();
    if (liveTtsOutputMode() === "python-device" && provider.playToDevice) {
      await this.live.startSpeech(estimateSpeechDurationMs(text));
      try {
        await provider.playToDevice(text, {
          filePrefix,
          outputDevice: process.env.KOKORO_AUDIO_DEVICE,
        });
      } finally {
        await this.live.stopSpeech();
      }
      return;
    }
    if (!this.ttsProvider && process.env.LIVE_TTS_STREAMING !== "false") {
      await this.live.playTtsStream(text);
      return;
    }
    await this.live.startSpeech(estimateSpeechDurationMs(text));
    const artifacts = await provider.synthesizeToFiles(text, { filePrefix });
    const first = artifacts[0];
    if (first) await this.live.playAudio(artifactPathToRendererUrl(first.path), text);
  }

  async passiveRespond(input: ContextStreamItem): Promise<CursorReport[]> {
    if (input.metadata?.liveAction === "start") return [await this.startLive()];
    if (input.metadata?.liveAction === "stop") return [await this.stopLive()];
    if (input.metadata?.liveAction === "caption" && typeof input.content === "string") {
      const result = await this.live.setCaption(input.content);
      this.stream.push(this.liveEvent(result.summary));
      return [this.report("live_caption_preview", "info", result.summary, false, { result })];
    }
    return [this.report("live_input_ignored", "debug", "Live Cursor ignored unsupported passive input.", false)];
  }

  enqueueSpeech(texts: string[], source = "stelle"): CursorReport {
    const seen = new Set(this.speechQueue.map((item) => normalizeSpeechText(item.text)));
    const accepted: string[] = [];
    for (const text of texts.map((item) => item.trim()).filter(Boolean)) {
      const normalized = normalizeSpeechText(text);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      accepted.push(text);
      if (accepted.length >= 12) break;
    }
    for (const text of accepted) {
      this.speechQueue.push({
        id: `live-speech-${now()}-${Math.random().toString(36).slice(2)}`,
        text,
        source,
        enqueuedAt: now(),
      });
    }
    const summary = `Queued ${accepted.length} live speech item(s).`;
    this.stream.push(this.liveEvent(`${summary} Queue length=${this.speechQueue.length}.`));
    return this.report("live_speech_queued", "info", summary, false, {
      queued: accepted.length,
      queueLength: this.speechQueue.length,
    });
  }

  getSpeechQueue(): LiveSpeechQueueItem[] {
    return [...this.speechQueue];
  }

  private liveEvent(content: string): ContextStreamItem {
    return {
      id: `live-event-${now()}`,
      type: "event",
      source: this.identity.id,
      timestamp: now(),
      content,
      trust: "cursor",
    };
  }
}

function normalizeSpeechText(text: string): string {
  return text.replace(/\s+/g, "").replace(/[，。！？!?；;、,.]/g, "");
}

function estimateSpeechDurationMs(text: string): number {
  const cjkChars = Array.from(text).filter((char) => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(char)).length;
  const latinWords = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  return Math.max(1200, Math.min(20000, Math.round(cjkChars * 220 + latinWords * 360)));
}

function liveTtsOutputMode(): "python-device" | "browser" | "artifact" {
  const value = (process.env.LIVE_TTS_OUTPUT ?? process.env.LIVE_AUDIO_OUTPUT ?? "browser").toLowerCase();
  if (value === "browser" || value === "artifact") return value;
  return "python-device";
}

function artifactPathToRendererUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const marker = "/artifacts/";
  const index = normalized.lastIndexOf(marker);
  if (index >= 0) return normalized.slice(index);
  if (normalized.startsWith("artifacts/")) return `/${normalized}`;
  return `/artifacts/tts/${normalized.split("/").pop()}`;
}
