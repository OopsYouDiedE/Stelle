import type { NormalizedLiveEvent } from "../../utils/live_event.js";

export type LivePlatformName = "bilibili" | "twitch" | "youtube" | "tiktok";

export interface LivePlatformStatus {
  platform: LivePlatformName;
  enabled: boolean;
  connected: boolean;
  authenticated?: boolean;
  roomId?: string;
  lastError?: string;
  received: number;
}

export interface LivePlatformBridge {
  readonly platform: LivePlatformName;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): LivePlatformStatus;
}

export type LivePlatformEventHandler = (event: NormalizedLiveEvent) => void;

export function liveEventId(platform: LivePlatformName, suffix?: string): string {
  return `${platform}-${Date.now()}-${suffix ?? Math.random().toString(36).slice(2, 8)}`;
}
