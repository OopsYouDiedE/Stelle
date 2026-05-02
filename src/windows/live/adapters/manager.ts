// === Imports ===
import type { RuntimeConfig } from "../../../config/index.js";
import type { StelleEventBus } from "../../../utils/event_bus.js";
import type { NormalizedLiveEvent } from "../../../utils/live_event.js";
import { LiveEventDeduper } from "../../../capabilities/perception/text_ingress/live_event_deduper.js";
import { applyLiveEventIdentity } from "../../../capabilities/perception/text_ingress/live_event_identity.js";
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
  private readonly deduper = new LiveEventDeduper(2 * 60_000, () => Date.now());

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
    const normalized = applyLiveEventIdentity(event, event.platformEventId ?? inferredPlatformEventId(event));
    if (!this.deduper.accept(normalized)) {
      this.eventBus.publish({
        type: "live.ingress.dropped",
        source: "system",
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

    const envelope = {
      ...normalized,
      event: normalized,
      normalized,
      platform: normalized.source,
      roomId: normalized.roomId,
      kind: normalized.kind,
      eventId: normalized.id,
      receivedAt: normalized.receivedAt,
    };

    this.eventBus.publish({
      type: "live.event.received",
      source: "system",
      id: normalized.id,
      timestamp: normalized.receivedAt,
      payload: envelope,
    });

    this.eventBus.publish({
      type: `live.event.${normalized.kind}` as any,
      source: "system",
      id: `${normalized.id}:${normalized.kind}`,
      timestamp: normalized.receivedAt,
      payload: envelope,
    });

    if (normalized.kind === "danmaku") {
      this.eventBus.publish({
        type: "live.danmaku.received",
        source: "system",
        id: `${normalized.id}:legacy`,
        timestamp: normalized.receivedAt,
        payload: envelope,
      });
    }
  }
}

// === Helpers ===
function inferredPlatformEventId(event: NormalizedLiveEvent): string | undefined {
  if (event.id.startsWith(`${event.source}-`) || event.id.startsWith("live-event-")) return undefined;
  return event.id;
}
