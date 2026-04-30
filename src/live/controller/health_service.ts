import type { LivePlatformStatus } from "../adapters/types.js";
import type { LivePlatformManager } from "../adapters/manager.js";
import type { StageOutputArbiter } from "../../actuator/output_arbiter.js";
import type { LiveRendererServer } from "../infra/renderer_server.js";
import type { LiveRuntime, ObsStatus } from "../../utils/live.js";
import type { StelleEventBus } from "../../utils/event_bus.js";

export interface LiveHealthSnapshot {
  sessionId: string;
  platforms: LivePlatformStatus[];
  ingress: {
    received: number;
    dropped: number;
    duplicates: number;
    lastEventAt?: number;
    averageLatencyMs?: number;
  };
  stageOutput: ReturnType<StageOutputArbiter["snapshot"]>;
  renderer?: ReturnType<LiveRendererServer["getStatus"]>;
  obs?: ObsStatus;
  tts: {
    queued: number;
    failures: number;
    lastProvider?: string;
    lastError?: string;
    lastStatusAt?: number;
  };
  moderation: {
    allowed: number;
    dropped: number;
    hidden: number;
    lastDecision?: Record<string, unknown>;
  };
  updatedAt: number;
}

export interface LiveHealthServiceDeps {
  sessionId: string;
  eventBus: StelleEventBus;
  stageOutput: StageOutputArbiter;
  live: LiveRuntime;
  renderer?: LiveRendererServer;
  platforms?: LivePlatformManager;
}

export class LiveHealthService {
  private unsubscribes: Array<() => void> = [];
  private received = 0;
  private dropped = 0;
  private duplicates = 0;
  private lastEventAt?: number;
  private latencySamples: number[] = [];
  private ttsQueued = 0;
  private ttsFailures = 0;
  private ttsLastProvider?: string;
  private ttsLastError?: string;
  private ttsLastStatusAt?: number;
  private moderationAllowed = 0;
  private moderationDropped = 0;
  private moderationHidden = 0;
  private moderationLastDecision?: Record<string, unknown>;
  private timer?: NodeJS.Timeout;

  constructor(private readonly deps: LiveHealthServiceDeps) {}

  start(): void {
    this.unsubscribes.push(this.deps.eventBus.subscribe("*", (event) => {
      if (event.type === "live.event.received") {
        this.received += 1;
        const receivedAt = Number(event.payload.receivedAt ?? event.timestamp);
        this.lastEventAt = event.timestamp;
        const latency = Math.max(0, Date.now() - receivedAt);
        this.latencySamples.push(latency);
        if (this.latencySamples.length > 100) this.latencySamples.shift();
      }
      if (event.type === "live.ingress.dropped") {
        this.dropped += 1;
        if (event.payload.reason === "duplicate") this.duplicates += 1;
      }
      if (event.type === "live.tts.status") {
        this.ttsQueued += event.payload.status === "queued" || event.payload.status === "streaming" ? 1 : 0;
        this.ttsLastProvider = typeof event.payload.provider === "string" ? event.payload.provider : this.ttsLastProvider;
        this.ttsLastStatusAt = event.timestamp;
      }
      if (event.type === "live.tts.error") {
        this.ttsFailures += 1;
        this.ttsLastError = String(event.payload.error ?? event.payload.message ?? "tts error");
        this.ttsLastStatusAt = event.timestamp;
      }
      if (event.type === "live.moderation.decision") {
        this.moderationLastDecision = event.payload;
        if (event.payload.action === "drop") this.moderationDropped += 1;
        else if (event.payload.action === "hide") this.moderationHidden += 1;
        else this.moderationAllowed += 1;
      }
    }));
    this.timer = setInterval(() => {
      void this.snapshot().then((snapshot) => {
        this.deps.renderer?.publishHealth(snapshot);
        this.deps.eventBus.publish({
          type: "live.health.updated",
          source: "live_health",
          id: `live-health-${Date.now()}`,
          timestamp: Date.now(),
          payload: snapshot as any,
        });
      }).catch(() => undefined);
    }, 5_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
  }

  async snapshot(): Promise<LiveHealthSnapshot> {
    const liveStatus = await this.deps.live.getStatus();
    return {
      sessionId: this.deps.sessionId,
      platforms: this.deps.platforms?.status() ?? [],
      ingress: {
        received: this.received,
        dropped: this.dropped,
        duplicates: this.duplicates,
        lastEventAt: this.lastEventAt,
        averageLatencyMs: average(this.latencySamples),
      },
      stageOutput: this.deps.stageOutput.snapshot(),
      renderer: this.deps.renderer?.getStatus(),
      obs: liveStatus.obs,
      tts: {
        queued: this.ttsQueued,
        failures: this.ttsFailures,
        lastProvider: this.ttsLastProvider,
        lastError: this.ttsLastError,
        lastStatusAt: this.ttsLastStatusAt,
      },
      moderation: {
        allowed: this.moderationAllowed,
        dropped: this.moderationDropped,
        hidden: this.moderationHidden,
        lastDecision: this.moderationLastDecision,
      },
      updatedAt: Date.now(),
    };
  }
}

function average(values: number[]): number | undefined {
  if (!values.length) return undefined;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
