// === Imports ===
import { asRecord } from "../../../utils/json.js";
import type { NormalizedLiveEvent } from "../live_event.js";
import type { LivePlatformBridge, LivePlatformEventHandler, LivePlatformStatus } from "./types.js";
import { liveEventId } from "./types.js";

// === Types ===
export interface TikTokPlatformOptions {
  enabled: boolean;
  username?: string;
  provider?: "websocket" | "tiktok-live-connector";
  webSocketUrl?: string;
  apiKey?: string;
}

type DynamicImport = (specifier: string) => Promise<Record<string, unknown>>;
type TikTokConnector = {
  connect?: () => Promise<unknown>;
  disconnect?: () => void;
  on?: (event: string, handler: (data: unknown) => void) => void;
};
type WebSocketLike = WebSocket & {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
};

// === Main Class ===
export class TikTokPlatformBridge implements LivePlatformBridge {
  readonly platform = "tiktok" as const;
  private socket?: WebSocketLike;
  private connector?: TikTokConnector;
  private connected = false;
  private authenticated = false;
  private lastError?: string;
  private received = 0;

  constructor(
    private readonly options: TikTokPlatformOptions,
    private readonly onEvent: LivePlatformEventHandler,
  ) {}

  // --- Lifecycle ---
  async start(): Promise<void> {
    if (!this.options.enabled) return;
    const provider =
      this.options.provider ??
      (this.options.webSocketUrl || process.env.TIKTOK_LIVE_WS_URL ? "websocket" : "tiktok-live-connector");
    if (provider === "websocket") {
      await this.startWebSocket();
      return;
    }
    await this.startConnector();
  }

  async stop(): Promise<void> {
    this.socket?.close();
    this.socket = undefined;
    this.connector?.disconnect?.();
    this.connector = undefined;
    this.connected = false;
    this.authenticated = false;
  }

  status(): LivePlatformStatus {
    return {
      platform: this.platform,
      enabled: this.options.enabled,
      connected: this.connected,
      authenticated: this.authenticated,
      roomId: this.options.username ?? process.env.TIKTOK_USERNAME,
      lastError: this.lastError,
      received: this.received,
    };
  }

  // --- WebSocket Implementation ---
  private async startWebSocket(): Promise<void> {
    const webSocketUrl = this.options.webSocketUrl ?? process.env.TIKTOK_LIVE_WS_URL;
    if (!webSocketUrl) {
      this.lastError = "Missing TIKTOK_LIVE_WS_URL for TikTok websocket provider.";
      return;
    }
    if (!globalThis.WebSocket) {
      this.lastError = "Global WebSocket is unavailable. Use Node.js >= 20.";
      return;
    }

    await new Promise<void>((resolve) => {
      const socket = new globalThis.WebSocket(webSocketUrl) as WebSocketLike;
      this.socket = socket;
      let settled = false;

      socket.onopen = () => {
        this.connected = true;
        this.authenticated = true;
        this.lastError = undefined;
        const username = this.options.username ?? process.env.TIKTOK_USERNAME;
        const apiKey = this.options.apiKey ?? process.env.TIKTOK_API_KEY;
        if (username || apiKey) {
          socket.send(JSON.stringify({ type: "subscribe", username, apiKey }));
        }
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      socket.onmessage = (message) => {
        for (const event of normalizeTikTokPayload(parseJson(String(message.data)))) {
          this.received += 1;
          this.onEvent(event);
        }
      };
      socket.onerror = () => {
        this.lastError = "TikTok WebSocket error.";
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      socket.onclose = () => {
        this.connected = false;
        this.authenticated = false;
      };
    });
  }

  // --- Connector Implementation ---
  private async startConnector(): Promise<void> {
    const username = this.options.username ?? process.env.TIKTOK_USERNAME;
    if (!username) {
      this.lastError = "Missing TIKTOK_USERNAME.";
      return;
    }
    try {
      const dynamicImport = new Function("specifier", "return import(specifier)") as DynamicImport;
      const mod = await dynamicImport("tiktok-live-connector");
      const Connection = (mod.WebcastPushConnection ?? mod.TikTokLiveConnection) as
        | (new (uniqueId: string) => TikTokConnector)
        | undefined;
      if (!Connection) throw new Error("tiktok-live-connector does not export WebcastPushConnection.");
      const connector = new Connection(username);
      this.connector = connector;

      connector.on?.("chat", (data) => this.forwardConnectorEvent("danmaku", data));
      connector.on?.("comment", (data) => this.forwardConnectorEvent("danmaku", data));
      connector.on?.("gift", (data) => this.forwardConnectorEvent("gift", data));
      connector.on?.("member", (data) => this.forwardConnectorEvent("entrance", data));
      connector.on?.("join", (data) => this.forwardConnectorEvent("entrance", data));
      connector.on?.("follow", (data) => this.forwardConnectorEvent("follow", data));
      connector.on?.("like", (data) => this.forwardConnectorEvent("like", data));

      await connector.connect?.();
      this.connected = true;
      this.authenticated = true;
      this.lastError = undefined;
    } catch (error) {
      this.lastError = `TikTok connector unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private forwardConnectorEvent(kind: NormalizedLiveEvent["kind"], payload: unknown): void {
    const event = normalizeTikTokObject(asRecord(payload), kind);
    this.received += 1;
    this.onEvent(event);
  }
}

// === Normalization ===
export function normalizeTikTokPayload(payload: unknown): NormalizedLiveEvent[] {
  const record = asRecord(payload);
  const messages = Array.isArray(record.messages)
    ? record.messages
    : Array.isArray(record.data)
      ? record.data
      : undefined;
  if (messages) return messages.map((item) => normalizeTikTokObject(asRecord(item))).filter(Boolean);
  return [normalizeTikTokObject(record)];
}

function normalizeTikTokObject(
  record: Record<string, unknown>,
  forcedKind?: NormalizedLiveEvent["kind"],
): NormalizedLiveEvent {
  const eventType = String(record.event ?? record.type ?? record.msgType ?? forcedKind ?? "unknown").toLowerCase();
  const kind = forcedKind ?? kindFromTikTokType(eventType);
  const user = asRecord(record.user ?? record.userDetails);
  const gift = asRecord(record.gift ?? record.giftDetails);
  const giftName = String(record.giftName ?? gift.name ?? gift.giftName ?? "");
  const amount = Number(record.diamondCount ?? record.repeatCount ?? gift.diamondCount ?? record.amount);
  return {
    id: String(record.id ?? record.msgId ?? liveEventId("tiktok")),
    source: "tiktok",
    kind,
    priority: kind === "gift" || kind === "guard" ? "medium" : "low",
    receivedAt: Number(record.timestamp ?? record.createTime ?? Date.now()),
    roomId: stringOrUndefined(record.roomId),
    user: {
      id: stringOrUndefined(record.userId ?? user.userId ?? user.uniqueId),
      name: String(record.nickname ?? record.uniqueId ?? user.nickname ?? user.uniqueId ?? "viewer"),
    },
    text: String(record.comment ?? record.text ?? giftName ?? ""),
    trustedPayment:
      kind === "gift"
        ? {
            rawType: "gift",
            amount: Number.isFinite(amount) ? amount : undefined,
            currency: "diamonds",
            giftName: giftName || "gift",
          }
        : undefined,
    rawCommand: eventType,
    raw: record,
  };
}

function kindFromTikTokType(value: string): NormalizedLiveEvent["kind"] {
  if (value.includes("chat") || value.includes("comment")) return "danmaku";
  if (value.includes("gift")) return "gift";
  if (value.includes("follow")) return "follow";
  if (value.includes("join") || value.includes("member")) return "entrance";
  if (value.includes("like")) return "like";
  return "unknown";
}

// === Helpers ===
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { text: raw, type: "unknown" };
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : typeof value === "number" ? String(value) : undefined;
}
