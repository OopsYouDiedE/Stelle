// === Imports ===
import { BilibiliDanmakuClient, type BilibiliCommand } from "../../utils/bilibili_danmaku.js";
import { asRecord } from "../../utils/json.js";
import type { NormalizedLiveEvent } from "../../utils/live_event.js";
import type { LivePlatformBridge, LivePlatformEventHandler, LivePlatformStatus } from "./types.js";
import { liveEventId } from "./types.js";

// === Types ===
export interface BilibiliPlatformOptions {
  enabled: boolean;
  roomId?: string;
}

// === Main Class ===
export class BilibiliPlatformBridge implements LivePlatformBridge {
  readonly platform = "bilibili" as const;
  private client?: BilibiliDanmakuClient;
  private connected = false;
  private authenticated = false;
  private lastError?: string;
  private received = 0;

  constructor(
    private readonly options: BilibiliPlatformOptions,
    private readonly onEvent: LivePlatformEventHandler,
  ) {}

  // --- Lifecycle ---
  async start(): Promise<void> {
    if (!this.options.enabled) return;
    const roomId = Number(this.options.roomId ?? process.env.BILIBILI_ROOM_ID);
    if (!Number.isFinite(roomId) || roomId <= 0) {
      this.lastError = "Missing Bilibili room id.";
      return;
    }

    this.client = new BilibiliDanmakuClient({ roomId });
    this.client.on("open", () => {
      this.connected = true;
      this.lastError = undefined;
    });
    this.client.on("authenticated", () => {
      this.authenticated = true;
    });
    this.client.on("close", () => {
      this.connected = false;
      this.authenticated = false;
    });
    this.client.on("error", (error) => {
      this.lastError = error instanceof Error ? error.message : String(error);
    });
    this.client.on("command", (command: BilibiliCommand) => {
      const event = normalizeBilibiliCommand(command, String(this.client?.status.roomId ?? roomId));
      if (!event) return;
      this.received += 1;
      this.onEvent(event);
    });

    try {
      await this.client.start();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  async stop(): Promise<void> {
    this.client?.stop();
    this.client = undefined;
    this.connected = false;
    this.authenticated = false;
  }

  status(): LivePlatformStatus {
    return {
      platform: this.platform,
      enabled: this.options.enabled,
      connected: this.connected,
      authenticated: this.authenticated,
      roomId: String(this.client?.status.roomId ?? this.options.roomId ?? ""),
      lastError: this.lastError,
      received: this.received,
    };
  }
}

// === Normalization ===
export function normalizeBilibiliCommand(command: BilibiliCommand, roomId?: string): NormalizedLiveEvent | undefined {
  const cmd = String(command.cmd ?? "UNKNOWN");
  const raw = command as Record<string, unknown>;
  const data = asRecord(raw.data);
  const info = raw.info;

  if (cmd === "DANMU_MSG") {
    const user = Array.isArray(info) && Array.isArray(info[2]) ? info[2] : [];
    return {
      id: liveEventId("bilibili", String(asRecord(raw).id ?? "")),
      source: "bilibili",
      kind: "danmaku",
      priority: "low",
      receivedAt: Date.now(),
      roomId,
      user: { id: String(user[0] ?? ""), name: String(user[1] ?? "观众") },
      text: typeof (info as unknown[] | undefined)?.[1] === "string" ? String((info as unknown[])[1]) : "",
      rawCommand: cmd,
      raw: command,
    };
  }

  if (cmd === "SUPER_CHAT_MESSAGE") {
    const userInfo = asRecord(data.user_info);
    return {
      id: liveEventId("bilibili"),
      source: "bilibili",
      kind: "super_chat",
      priority: "high",
      receivedAt: Date.now(),
      roomId,
      user: { id: String(data.uid ?? userInfo.uid ?? ""), name: String(userInfo.uname ?? data.user_name ?? "观众") },
      text: String(data.message ?? ""),
      trustedPayment: { rawType: "super_chat", amount: numberOrUndefined(data.price), currency: "CNY" },
      rawCommand: cmd,
      raw: command,
    };
  }

  if (cmd === "SEND_GIFT") {
    return {
      id: liveEventId("bilibili"),
      source: "bilibili",
      kind: "gift",
      priority: "medium",
      receivedAt: Date.now(),
      roomId,
      user: { id: String(data.uid ?? ""), name: String(data.uname ?? "观众") },
      text: String(data.giftName ?? data.gift_name ?? "礼物"),
      trustedPayment: {
        rawType: "gift",
        amount: numberOrUndefined(data.price) ?? numberOrUndefined(data.total_coin),
        currency: "CNY",
        giftName: String(data.giftName ?? data.gift_name ?? "礼物"),
      },
      rawCommand: cmd,
      raw: command,
    };
  }

  if (cmd === "GUARD_BUY") {
    return {
      id: liveEventId("bilibili"),
      source: "bilibili",
      kind: "guard",
      priority: "high",
      receivedAt: Date.now(),
      roomId,
      user: { id: String(data.uid ?? ""), name: String(data.username ?? data.uname ?? "观众") },
      text: String(data.gift_name ?? data.guard_level ?? "上舰"),
      trustedPayment: {
        rawType: "guard",
        amount: numberOrUndefined(data.price),
        currency: "CNY",
        giftName: String(data.gift_name ?? "舰长"),
      },
      rawCommand: cmd,
      raw: command,
    };
  }

  if (cmd === "INTERACT_WORD") {
    return {
      id: liveEventId("bilibili"),
      source: "bilibili",
      kind: "entrance",
      priority: "low",
      receivedAt: Date.now(),
      roomId,
      user: { id: String(data.uid ?? ""), name: String(data.uname ?? "观众") },
      text: "进入直播间",
      rawCommand: cmd,
      raw: command,
    };
  }

  return undefined;
}

// === Helpers ===
function numberOrUndefined(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
