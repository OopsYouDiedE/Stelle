import { loadLiveConfig } from "./config.js";
import type { StelleEventBus as EventBus } from "../../core/event/event_bus.js";
import type { PerceptualEvent } from "../../core/protocol/perceptual_event.js";
import { LivePlatformSupervisor } from "./adapters/supervisor.js";
import { BilibiliPlatformBridge } from "./adapters/bilibili_adapter.js";
import type { NormalizedLiveEvent } from "./live_event.js";

export interface LiveWindowOptions {
  eventBus: EventBus;
  config: any;
  logger: any;
}

export class LiveWindow {
  private supervisor?: LivePlatformSupervisor;

  constructor(private options: LiveWindowOptions) {}

  async start(): Promise<void> {
    this.options.logger.info("Live Window starting platforms...");

    const bilibiliConfig = loadLiveConfig(this.options.config.rawYaml).platforms.bilibili;
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
  if (kind === "danmaku") return "text.message";
  if (kind === "gift" || kind === "super_chat" || kind === "guard") return "priority.event";
  return "platform.event";
}
