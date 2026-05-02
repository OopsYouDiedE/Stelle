// === Imports ===
import type { NormalizedLiveEvent } from "../live_event.js";
import type { LivePlatformBridge, LivePlatformEventHandler, LivePlatformStatus } from "./types.js";
import { liveEventId } from "./types.js";

// === Types ===
export interface TwitchPlatformOptions {
  enabled: boolean;
  channel?: string;
  username?: string;
  oauthToken?: string;
  trackJoins?: boolean;
}

type WebSocketLike = WebSocket & {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
};

// === Main Class ===
export class TwitchPlatformBridge implements LivePlatformBridge {
  readonly platform = "twitch" as const;
  private socket?: WebSocketLike;
  private connected = false;
  private authenticated = false;
  private lastError?: string;
  private received = 0;

  constructor(
    private readonly options: TwitchPlatformOptions,
    private readonly onEvent: LivePlatformEventHandler,
  ) {}

  // --- Lifecycle ---
  async start(): Promise<void> {
    if (!this.options.enabled) return;
    const channel = normalizeChannel(this.options.channel ?? process.env.TWITCH_CHANNEL ?? process.env.TWITCH_ROOM);
    const username = (this.options.username ?? process.env.TWITCH_BOT_USERNAME ?? "justinfan12345").trim();
    const oauthToken = (this.options.oauthToken ?? process.env.TWITCH_OAUTH_TOKEN ?? "").trim();
    if (!channel) {
      this.lastError = "Missing Twitch channel.";
      return;
    }
    if (!globalThis.WebSocket) {
      this.lastError = "Global WebSocket is unavailable. Use Node.js >= 20.";
      return;
    }

    await new Promise<void>((resolve) => {
      const socket = new globalThis.WebSocket("wss://irc-ws.chat.twitch.tv:443") as WebSocketLike;
      this.socket = socket;
      let settled = false;

      socket.onopen = () => {
        this.connected = true;
        this.lastError = undefined;
        socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership");
        socket.send(`PASS ${oauthToken || "SCHMOOPIIE"}`);
        socket.send(`NICK ${username}`);
        socket.send(`JOIN #${channel}`);
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      socket.onmessage = (message) => {
        for (const line of String(message.data).split(/\r?\n/).filter(Boolean)) {
          this.handleLine(line, channel);
        }
      };

      socket.onerror = () => {
        this.lastError = "Twitch IRC WebSocket error.";
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

  async stop(): Promise<void> {
    this.socket?.close();
    this.socket = undefined;
    this.connected = false;
    this.authenticated = false;
  }

  status(): LivePlatformStatus {
    return {
      platform: this.platform,
      enabled: this.options.enabled,
      connected: this.connected,
      authenticated: this.authenticated,
      roomId: normalizeChannel(this.options.channel ?? process.env.TWITCH_CHANNEL ?? ""),
      lastError: this.lastError,
      received: this.received,
    };
  }

  // --- Line Handling ---
  private handleLine(line: string, channel: string): void {
    if (line.startsWith("PING")) {
      this.socket?.send("PONG :tmi.twitch.tv");
      return;
    }
    if (line.includes("GLOBALUSERSTATE") || line.includes("001")) {
      this.authenticated = true;
      return;
    }

    const event = normalizeTwitchIrcLine(line, channel, Boolean(this.options.trackJoins));
    if (!event) return;
    this.received += 1;
    this.onEvent(event);
  }
}

// === Normalization ===
export function normalizeTwitchIrcLine(
  line: string,
  channel: string,
  trackJoins = false,
): NormalizedLiveEvent | undefined {
  const parsed = parseIrcLine(line);
  if (!parsed) return undefined;

  if (parsed.command === "PRIVMSG") {
    const bits = numberOrUndefined(parsed.tags.bits);
    return {
      id: parsed.tags.id || liveEventId("twitch"),
      source: "twitch",
      kind: bits ? "gift" : "danmaku",
      priority: bits ? "medium" : "low",
      receivedAt: numberOrUndefined(parsed.tags["tmi-sent-ts"]) ?? Date.now(),
      roomId: parsed.tags["room-id"] || channel,
      user: {
        id: parsed.tags["user-id"] || parsed.user,
        name: parsed.tags["display-name"] || parsed.user || "viewer",
      },
      text: parsed.trailing,
      trustedPayment: bits ? { rawType: "gift", amount: bits, currency: "bits", giftName: "bits" } : undefined,
      rawCommand: parsed.command,
      raw: { line, tags: parsed.tags },
    };
  }

  if (parsed.command === "USERNOTICE") {
    const messageId = parsed.tags["msg-id"] ?? "";
    return {
      id: parsed.tags.id || liveEventId("twitch"),
      source: "twitch",
      kind: messageId.includes("sub") ? "guard" : "system",
      priority: messageId.includes("sub") ? "high" : "medium",
      receivedAt: numberOrUndefined(parsed.tags["tmi-sent-ts"]) ?? Date.now(),
      roomId: parsed.tags["room-id"] || channel,
      user: {
        id: parsed.tags["user-id"] || parsed.user,
        name: parsed.tags["display-name"] || parsed.user || "viewer",
      },
      text: parsed.trailing || messageId,
      trustedPayment: messageId.includes("sub")
        ? { rawType: "guard", giftName: messageId, currency: "subscription" }
        : undefined,
      rawCommand: parsed.command,
      raw: { line, tags: parsed.tags },
    };
  }

  if (trackJoins && parsed.command === "JOIN") {
    return {
      id: liveEventId("twitch", parsed.user),
      source: "twitch",
      kind: "entrance",
      priority: "low",
      receivedAt: Date.now(),
      roomId: channel,
      user: { id: parsed.user, name: parsed.user || "viewer" },
      text: "进入直播间",
      rawCommand: parsed.command,
      raw: { line, tags: parsed.tags },
    };
  }

  return undefined;
}

// === IRC Parsing ===
function parseIrcLine(
  line: string,
): { tags: Record<string, string>; user?: string; command: string; trailing: string } | undefined {
  let rest = line;
  const tags: Record<string, string> = {};
  if (rest.startsWith("@")) {
    const space = rest.indexOf(" ");
    if (space < 0) return undefined;
    for (const tag of rest.slice(1, space).split(";")) {
      const [key, value = ""] = tag.split("=");
      if (key) tags[key] = unescapeIrcTag(value);
    }
    rest = rest.slice(space + 1);
  }

  let user: string | undefined;
  if (rest.startsWith(":")) {
    const space = rest.indexOf(" ");
    if (space < 0) return undefined;
    const prefix = rest.slice(1, space);
    user = prefix.split("!")[0];
    rest = rest.slice(space + 1);
  }

  const trailingIndex = rest.indexOf(" :");
  const beforeTrailing = trailingIndex >= 0 ? rest.slice(0, trailingIndex) : rest;
  const trailing = trailingIndex >= 0 ? rest.slice(trailingIndex + 2) : "";
  const command = beforeTrailing.split(/\s+/)[0] ?? "";
  return command ? { tags, user, command, trailing } : undefined;
}

function unescapeIrcTag(value: string): string {
  return value
    .replace(/\\s/g, " ")
    .replace(/\\:/g, ";")
    .replace(/\\\\/g, "\\")
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n");
}

// === Helpers ===
function normalizeChannel(value: string | undefined): string {
  return (value ?? "").trim().replace(/^#/, "").toLowerCase();
}

function numberOrUndefined(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
