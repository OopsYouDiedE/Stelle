import type { RuntimeConfig } from "../../utils/config_loader.js";
import type { StelleEventBus } from "../../utils/event_bus.js";
import type { NormalizedLiveEvent } from "../../utils/live_event.js";
import { BilibiliPlatformBridge } from "./bilibili.js";
import { TikTokPlatformBridge } from "./tiktok.js";
import { TwitchPlatformBridge } from "./twitch.js";
import { YoutubePlatformBridge } from "./youtube.js";
import type { LivePlatformBridge, LivePlatformStatus } from "./types.js";

export class LivePlatformManager {
  private readonly bridges: LivePlatformBridge[];

  constructor(config: RuntimeConfig, private readonly eventBus: StelleEventBus) {
    const platforms = config.live.platforms;
    const onEvent = (event: NormalizedLiveEvent) => this.publish(event);
    this.bridges = [
      new BilibiliPlatformBridge(platforms.bilibili, onEvent),
      new TwitchPlatformBridge(platforms.twitch, onEvent),
      new YoutubePlatformBridge(platforms.youtube, onEvent),
      new TikTokPlatformBridge(platforms.tiktok, onEvent),
    ];
  }

  async start(): Promise<void> {
    await Promise.all(this.bridges.map((bridge) => bridge.start()));
  }

  async stop(): Promise<void> {
    await Promise.allSettled(this.bridges.map((bridge) => bridge.stop()));
  }

  status(): LivePlatformStatus[] {
    return this.bridges.map((bridge) => bridge.status());
  }

  private publish(event: NormalizedLiveEvent): void {
    this.eventBus.publish({
      type: "live.danmaku.received",
      source: "system",
      id: event.id,
      timestamp: event.receivedAt,
      payload: {
        ...event,
        normalized: event,
      },
    });
  }
}

