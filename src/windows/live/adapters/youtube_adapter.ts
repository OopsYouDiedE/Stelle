// === Imports ===
import { asRecord } from "../../../shared/json.js";
import type { NormalizedLiveEvent } from "../live_event.js";
import type { LivePlatformBridge, LivePlatformEventHandler, LivePlatformStatus } from "./types.js";
import { liveEventId } from "./types.js";

// === Constants ===
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

// === Types ===
export interface YoutubePlatformOptions {
  enabled: boolean;
  liveChatId?: string;
  videoId?: string;
  apiKey?: string;
  oauthToken?: string;
  forwardHistory?: boolean;
}

// === Main Class ===
export class YoutubePlatformBridge implements LivePlatformBridge {
  readonly platform = "youtube" as const;
  private connected = false;
  private authenticated = false;
  private lastError?: string;
  private received = 0;
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private liveChatId?: string;
  private nextPageToken?: string;
  private firstPoll = true;

  constructor(
    private readonly options: YoutubePlatformOptions,
    private readonly onEvent: LivePlatformEventHandler,
  ) {}

  // --- Lifecycle ---
  async start(): Promise<void> {
    if (!this.options.enabled) return;
    this.stopped = false;
    try {
      this.liveChatId = await this.resolveLiveChatId();
      if (!this.liveChatId) {
        this.lastError = "Missing YouTube liveChatId or resolvable videoId.";
        return;
      }
      this.connected = true;
      this.authenticated = true;
      await this.poll();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.connected = false;
  }

  status(): LivePlatformStatus {
    return {
      platform: this.platform,
      enabled: this.options.enabled,
      connected: this.connected,
      authenticated: this.authenticated,
      roomId: this.liveChatId ?? this.options.liveChatId ?? this.options.videoId,
      lastError: this.lastError,
      received: this.received,
    };
  }

  // --- Poll Logic ---
  private async resolveLiveChatId(): Promise<string | undefined> {
    const direct = this.options.liveChatId ?? process.env.YOUTUBE_LIVE_CHAT_ID;
    if (direct) return direct;
    const videoId = this.options.videoId ?? process.env.YOUTUBE_VIDEO_ID;
    if (!videoId) return undefined;
    const payload = await this.fetchJson("/videos", {
      part: "liveStreamingDetails",
      id: videoId,
    });
    const item = Array.isArray(payload.items) ? asRecord(payload.items[0]) : {};
    const details = asRecord(item.liveStreamingDetails);
    return typeof details.activeLiveChatId === "string" ? details.activeLiveChatId : undefined;
  }

  private async poll(): Promise<void> {
    if (this.stopped || !this.liveChatId) return;
    try {
      const payload = await this.fetchJson("/liveChat/messages", {
        liveChatId: this.liveChatId,
        part: "id,snippet,authorDetails",
        maxResults: "200",
        ...(this.nextPageToken ? { pageToken: this.nextPageToken } : {}),
      });
      this.nextPageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : this.nextPageToken;

      const items = Array.isArray(payload.items) ? payload.items : [];
      const shouldForward =
        !this.firstPoll || this.options.forwardHistory === true || process.env.YOUTUBE_FORWARD_HISTORY === "true";
      if (shouldForward) {
        for (const item of items) {
          const event = normalizeYoutubeMessage(asRecord(item), this.liveChatId);
          if (!event) continue;
          this.received += 1;
          this.onEvent(event);
        }
      }
      this.firstPoll = false;
      this.lastError = undefined;

      const delay = clamp(Number(payload.pollingIntervalMillis), 1_000, 60_000, 5_000);
      this.timer = setTimeout(() => void this.poll(), delay);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.timer = setTimeout(() => void this.poll(), 10_000);
    }
  }

  private async fetchJson(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const apiKey = this.options.apiKey ?? process.env.YOUTUBE_API_KEY;
    const oauthToken = this.options.oauthToken ?? process.env.YOUTUBE_OAUTH_TOKEN;
    if (!apiKey && !oauthToken) throw new Error("Missing YOUTUBE_API_KEY or YOUTUBE_OAUTH_TOKEN.");

    const url = new URL(`${YOUTUBE_API_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (apiKey) url.searchParams.set("key", apiKey);

    const response = await fetch(url, {
      headers: oauthToken ? { authorization: `Bearer ${oauthToken}` } : undefined,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`YouTube API failed ${response.status}: ${detail || response.statusText}`);
    }
    return asRecord(await response.json());
  }
}

// === Normalization ===
export function normalizeYoutubeMessage(
  message: Record<string, unknown>,
  liveChatId?: string,
): NormalizedLiveEvent | undefined {
  const snippet = asRecord(message.snippet);
  const author = asRecord(message.authorDetails);
  const type = String(snippet.type ?? "");
  const text = String(snippet.displayMessage ?? asRecord(snippet.textMessageDetails).messageText ?? "");
  const superChat = asRecord(snippet.superChatDetails);
  const superSticker = asRecord(snippet.superStickerDetails);

  if (type === "textMessageEvent") {
    return baseYoutubeEvent(message, liveChatId, "danmaku", "low", text);
  }
  if (type === "superChatEvent") {
    return {
      ...baseYoutubeEvent(message, liveChatId, "super_chat", "high", text),
      trustedPayment: {
        rawType: "super_chat",
        amount: microsToUnit(superChat.amountMicros),
        currency: stringOrUndefined(superChat.currency),
      },
    };
  }
  if (type === "superStickerEvent") {
    return {
      ...baseYoutubeEvent(message, liveChatId, "gift", "medium", text || "Super Sticker"),
      trustedPayment: {
        rawType: "gift",
        amount: microsToUnit(superSticker.amountMicros),
        currency: stringOrUndefined(superSticker.currency),
        giftName: "Super Sticker",
      },
    };
  }
  if (
    type === "newSponsorEvent" ||
    type === "memberMilestoneChatEvent" ||
    type === "membershipGiftingEvent" ||
    type === "giftMembershipReceivedEvent"
  ) {
    return {
      ...baseYoutubeEvent(message, liveChatId, "guard", "high", text || "会员事件"),
      trustedPayment: { rawType: "guard", giftName: type, currency: "membership" },
    };
  }
  if (type === "pollEvent") {
    return baseYoutubeEvent(message, liveChatId, "system", "medium", text || "投票事件");
  }

  if (author.displayName || text) {
    return baseYoutubeEvent(message, liveChatId, "unknown", "low", text);
  }
  return undefined;
}

function baseYoutubeEvent(
  message: Record<string, unknown>,
  liveChatId: string | undefined,
  kind: NormalizedLiveEvent["kind"],
  priority: NormalizedLiveEvent["priority"],
  text: string,
): NormalizedLiveEvent {
  const snippet = asRecord(message.snippet);
  const author = asRecord(message.authorDetails);
  return {
    id: String(message.id ?? liveEventId("youtube")),
    source: "youtube",
    kind,
    priority,
    receivedAt: Date.parse(String(snippet.publishedAt ?? "")) || Date.now(),
    roomId: liveChatId,
    user: {
      id: stringOrUndefined(author.channelId),
      name: String(author.displayName ?? "viewer"),
    },
    text,
    rawCommand: String(snippet.type ?? "unknown"),
    raw: message,
  };
}

// === Helpers ===
function microsToUnit(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number / 1_000_000 : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
