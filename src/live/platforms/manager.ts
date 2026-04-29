import type { RuntimeConfig } from "../../utils/config_loader.js";
import type { StelleEventBus } from "../../utils/event_bus.js";
import type { NormalizedLiveEvent } from "../../utils/live_event.js";
import { LiveEventDeduper } from "../ingress/live_event_deduper.js";
import { applyLiveEventIdentity } from "../ingress/live_event_identity.js";
import { BilibiliPlatformBridge } from "./bilibili.js";
import { TikTokPlatformBridge } from "./tiktok.js";
import { TwitchPlatformBridge } from "./twitch.js";
import { YoutubePlatformBridge } from "./youtube.js";
import { LivePlatformSupervisor } from "./supervisor.js";
import type { LivePlatformBridge, LivePlatformStatus } from "./types.js";

export class LivePlatformManager {
  private readonly bridges: LivePlatformBridge[];
  private readonly supervisors: LivePlatformSupervisor[];
  private readonly deduper = new LiveEventDeduper(2 * 60_000, () => Date.now());

  constructor(config: RuntimeConfig, private readonly eventBus: StelleEventBus) {
    const platforms = config.live.platforms;
    const onEvent = (event: NormalizedLiveEvent) => this.publish(event);
    this.bridges = [
      new BilibiliPlatformBridge(platforms.bilibili, onEvent),
      new TwitchPlatformBridge(platforms.twitch, onEvent),
      new YoutubePlatformBridge(platforms.youtube, onEvent),
      new TikTokPlatformBridge(platforms.tiktok, onEvent),
    ];
    this.supervisors = this.bridges.map((bridge) => new LivePlatformSupervisor(bridge, this.eventBus));
  }

  async start(): Promise<void> {
    for (const supervisor of this.supervisors) supervisor.start();
  }

  async stop(): Promise<void> {
    await Promise.allSettled(this.supervisors.map((supervisor) => supervisor.stop()));
  }

  status(): LivePlatformStatus[] {
    return this.bridges.map((bridge) => bridge.status());
  }

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

function inferredPlatformEventId(event: NormalizedLiveEvent): string | undefined {
  if (event.id.startsWith(`${event.source}-`) || event.id.startsWith("live-event-")) return undefined;
  return event.id;
}
