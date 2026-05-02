// === Imports ===
import type { RuntimeConfig } from "../../../config/index.js";
import type { PerceptualEvent } from "../../../core/protocol/perceptual_event.js";
import type { StelleEventBus } from "../../../core/event/event_bus.js";
import type { NormalizedLiveEvent } from "../live_event.js";
import { TextEventDeduper } from "../../../capabilities/perception/text_ingress/text_event_deduper.js";
import { applyTextEventIdentity } from "../../../capabilities/perception/text_ingress/text_event_identity.js";
import { BilibiliPlatformBridge } from "./bilibili_adapter.js";
import { TikTokPlatformBridge } from "./tiktok_adapter.js";
import { TwitchPlatformBridge } from "./twitch_adapter.js";
import { YoutubePlatformBridge } from "./youtube_adapter.js";
import { LivePlatformSupervisor } from "./supervisor.js";
import type { LivePlatformBridge, LivePlatformStatus } from "./types.js";

// === Main Class ===
export class LivePlatformManager {
  private readonly bridges: LivePlatformBridge[];
  private readonly supervisors: LivePlatformSupervisor[];
  private readonly deduper = new TextEventDeduper(2 * 60_000, () => Date.now());

  constructor(
    config: RuntimeConfig,
    private readonly eventBus: StelleEventBus,
  ) {
    const platforms = config.live.platforms;
    const onEvent = (event: NormalizedLiveEvent) => this.publish(event);
    this.bridges = [
      new BilibiliPlatformBridge(platforms.bilibili, onEvent),
      new TwitchPlatformBridge(platforms.twitch, onEvent),
      new YoutubePlatformBridge(platforms.youtube, onEvent),
      new TikTokPlatformBridge(platforms.tiktok, onEvent),
    ];
    this.supervisors = this.bridges.map(
      (bridge) => new LivePlatformSupervisor(bridge, this.eventBus, (this.eventBus as any).logger || console),
    );
  }

  // --- Lifecycle ---
  async start(): Promise<void> {
    for (const supervisor of this.supervisors) supervisor.start();
  }

  async stop(): Promise<void> {
    await Promise.allSettled(this.supervisors.map((supervisor) => supervisor.stop()));
  }

  status(): LivePlatformStatus[] {
    return this.bridges.map((bridge) => bridge.status());
  }

  publishFixtureEvent(event: NormalizedLiveEvent): void {
    this.publish(event);
  }

  // --- Event Handling ---
  private publish(event: NormalizedLiveEvent): void {
    const normalized = applyTextEventIdentity(event, event.platformEventId ?? inferredPlatformEventId(event));
    if (!this.deduper.accept(normalized)) {
      this.eventBus.publish({
        type: "perception.ingress.dropped",
        source: "window.live",
        id: `${normalized.id}:duplicate`,
        timestamp: normalized.receivedAt,
        payload: {
          event: normalized,
          normalized,
          reason: "duplicate",
          platform: normalized.source,
          kind: normalized.kind,
          eventId: normalized.id,
        },
      });
      return;
    }

    const perceptualEvent = liveEventToPerceptualEvent(normalized);

    this.eventBus.publish({
      type: "perceptual.event",
      source: "window.live",
      id: normalized.id,
      timestamp: normalized.receivedAt,
      payload: perceptualEvent,
    });

    this.eventBus.publish({
      type: "program.interaction.received",
      source: "window.live",
      id: `${normalized.id}:${normalized.kind}`,
      timestamp: normalized.receivedAt,
      payload: perceptualEvent,
    });
  }
}

// === Helpers ===
function inferredPlatformEventId(event: NormalizedLiveEvent): string | undefined {
  if (event.id.startsWith(`${event.source}-`) || event.id.startsWith("live-event-")) return undefined;
  return event.id;
}

function liveEventToPerceptualEvent(event: NormalizedLiveEvent): PerceptualEvent {
  return {
    id: event.id,
    type: event.kind === "danmaku" ? "text.message" : "platform.event",
    sourceWindow: "window.live",
    actorId: event.user?.id,
    timestamp: event.receivedAt,
    salienceHint: event.priority === "high" ? 1 : event.priority === "medium" ? 0.6 : 0.2,
    payload: {
      text: event.text,
      actor: event.user,
      kind: event.kind,
      trust: { paid: Boolean(event.trustedPayment) },
    },
    metadata: {
      platform: event.source,
      roomId: event.roomId,
      platformEventId: event.platformEventId,
    },
  };
}
