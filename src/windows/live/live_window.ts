import type { StelleEventBus as EventBus } from "../../utils/event_bus.js";
import type { PerceptualEvent } from "../../core/protocol/perceptual_event.js";
import type { RuntimeKernel } from "../../capabilities/cognition/runtime_kernel/kernel.js";
import type { StageOutputArbiter } from "../../capabilities/expression/stage_output/arbiter.js";
import type { ComponentRegistry } from "../../core/protocol/component.js";
import { LivePlatformSupervisor } from "./adapters/supervisor.js";
import { BilibiliPlatformBridge } from "./adapters/bilibili_adapter.js";
import type { RuntimeConfig } from "../../config/index.js";
import type { OutputIntent } from "../../capabilities/expression/stage_output/types.js";
import type { NormalizedLiveEvent } from "../../utils/live_event.js";

export interface LiveWindowOptions {
  eventBus: EventBus;
  registry: ComponentRegistry;
  config: RuntimeConfig;
  logger: any;
}

export class LiveWindow {
  private supervisor?: LivePlatformSupervisor;

  constructor(private options: LiveWindowOptions) {}

  async start(): Promise<void> {
    this.options.logger.info("Live Window starting platforms...");

    const bilibiliConfig = this.options.config.live.platforms.bilibili;
    if (bilibiliConfig?.enabled) {
      const bridge = new BilibiliPlatformBridge(bilibiliConfig, (event) => {
        void this.receivePlatformEvent(event).catch((error) => {
          this.options.logger.error("Live Window failed to process platform event", error);
        });
      });
      this.supervisor = new LivePlatformSupervisor(bridge, this.options.eventBus, this.options.logger);
      void this.supervisor.start();
    }
  }

  async stop(): Promise<void> {
    this.options.logger.info("Live Window stopping platforms...");
    if (this.supervisor) {
      await this.supervisor.stop();
    }
  }

  async receivePlatformEvent(event: NormalizedLiveEvent): Promise<void> {
    const perceptualEvent = liveEventToPerceptualEvent(event);
    this.emitPerceptualEvent(perceptualEvent);
    await this.processPerceptualEvent(perceptualEvent);
  }

  async processPerceptualEvent(event: PerceptualEvent): Promise<void> {
    const kernel = this.options.registry.resolve<RuntimeKernel>("cognition.kernel");
    const stageOutput = this.options.registry.resolve<StageOutputArbiter>("expression.stage_output");

    if (!kernel || !stageOutput) {
      this.options.logger.warn("Kernel or StageOutput not available in LiveWindow");
      return;
    }

    const decisions = await kernel.step(event);

    for (const decision of decisions) {
      if (decision.kind === "intent" && decision.intent.type === "respond") {
        await stageOutput.propose(toStageOutputIntent(decision.intent, event.id));
      }
    }
  }

  protected emitPerceptualEvent(event: PerceptualEvent): void {
    this.options.eventBus.publish({
      type: "perceptual.event",
      source: "window.live",
      timestamp: Date.now(),
      payload: event,
    } as any);
  }

  getStatus() {
    return {
      supervisor: this.supervisor?.status(),
    };
  }
}

function liveEventToPerceptualEvent(event: NormalizedLiveEvent): PerceptualEvent {
  return {
    id: event.id,
    type: liveEventKindToPerceptualType(event.kind),
    sourceWindow: "window.live",
    actorId: event.user?.id,
    timestamp: event.receivedAt,
    salienceHint: event.priority === "high" ? 1 : event.priority === "medium" ? 0.6 : 0.2,
    payload: {
      text: event.text,
      actor: event.user,
      kind: event.kind,
      trust: {
        paid: Boolean(event.trustedPayment),
      },
    },
    metadata: {
      rawPlatform: event.source,
      platformEventId: event.platformEventId,
      priority: event.priority,
    },
  };
}

function liveEventKindToPerceptualType(kind: NormalizedLiveEvent["kind"]): string {
  if (kind === "danmaku") return "live.text_message";
  if (kind === "gift" || kind === "super_chat" || kind === "guard") return "live.priority_event";
  return "live.platform_event";
}

function toStageOutputIntent(
  intent: { id: string; priority: number; payload: unknown },
  sourceEventId: string,
): OutputIntent {
  const payload = (intent.payload ?? {}) as Partial<OutputIntent> & { text?: string };
  return {
    id: payload.id ?? intent.id,
    cursorId: payload.cursorId ?? "live_window",
    sourceEventId: payload.sourceEventId ?? sourceEventId,
    lane: payload.lane ?? "direct_response",
    priority: payload.priority ?? intent.priority,
    salience: payload.salience ?? "medium",
    text: payload.text ?? "",
    ttlMs: payload.ttlMs ?? 30_000,
    interrupt: payload.interrupt ?? "soft",
    output: payload.output ?? { caption: true, tts: true },
    metadata: payload.metadata,
  };
}
