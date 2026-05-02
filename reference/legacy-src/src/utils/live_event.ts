/**
 * Module: Live event normalization and hard moderation
 */

// === Imports ===
import { asRecord, enumValue } from "./json.js";
import { sanitizeExternalText, truncateText } from "./text.js";
import type { LiveEventMetadata } from "./intent_schema.js";

// === Types & Interfaces ===
export type LiveEventSource = "bilibili" | "twitch" | "youtube" | "tiktok" | "fixture" | "debug";
export type LiveEventKind =
  | "danmaku"
  | "super_chat"
  | "gift"
  | "guard"
  | "entrance"
  | "follow"
  | "like"
  | "system"
  | "unknown";
export type LiveEventPriority = "low" | "medium" | "high";

export interface NormalizedLiveEvent {
  id: string;
  platformEventId?: string;
  fingerprint?: string;
  source: LiveEventSource;
  kind: LiveEventKind;
  priority: LiveEventPriority;
  receivedAt: number;
  roomId?: string;
  user?: {
    id?: string;
    name?: string;
  };
  text: string;
  trustedPayment?: {
    amount?: number;
    currency?: string;
    giftName?: string;
    rawType: "super_chat" | "gift" | "guard";
  };
  metadata?: LiveEventMetadata;
  rawCommand?: string;
  raw?: unknown;
}

export interface LiveModerationResult {
  allowed: boolean;
  action: "allow" | "drop" | "hide";
  reason: string;
  category?: "political" | "spam" | "empty" | "abuse" | "privacy" | "prompt_injection" | "sexual" | "minor_safety";
  visibleToControlRoom?: boolean;
}

// === Core Logic ===

const POLITICAL_PATTERNS = [
  /政治/,
  /时政/,
  /选举/,
  /总统/,
  /主席/,
  /总理/,
  /政府/,
  /政党/,
  /国会/,
  /外交/,
  /台海/,
  /台湾/,
  /香港/,
  /新疆/,
  /西藏/,
  /乌克兰/,
  /俄罗斯/,
  /巴以/,
  /以色列/,
  /哈马斯/,
  /特朗普|川普|拜登|习近平|普京|泽连斯基/,
  /\b(CCP|CPC|DPP|KMT|NATO|UN)\b/i,
];

const SPAM_PATTERNS = [
  /(.)\1{8,}/u,
  /^(哈哈|hhh|www|111|666|。。|？？){4,}$/iu,
  /(加群|私信|代刷|刷粉|免费领取|点击链接)/u,
];

const ABUSE_PATTERNS = [/傻逼|垃圾|废物|去死|滚|脑残|弱智/u, /\b(kys|idiot|stupid)\b/i];

const PRIVACY_PATTERNS = [/身份证|手机号|电话号码|住址|家庭住址|真实姓名|开盒|人肉|隐私|私人信息/u, /\b\d{11}\b/];

const PROMPT_INJECTION_PATTERNS = [
  /忽略(以上|之前|所有).*(规则|指令|设定)/u,
  /system prompt|developer message|越权|调用工具|执行命令|泄露提示词/i,
];

const SEXUAL_PATTERNS = [/色情|裸照|约炮|性爱|黄片|成人内容/u];

const MINOR_SAFETY_PATTERNS = [/未成年.*(裸|性|约|隐私)|小学生.*(裸|性|约)/u];

/**
 * Normalizes raw external event data into a standardized internal format.
 */
export function normalizeLiveEvent(input: Record<string, unknown>): NormalizedLiveEvent {
  const raw = asRecord(input.raw ?? input);
  const normalized = asRecord(input.normalized);
  const command = String(input.cmd ?? raw.cmd ?? normalized.eventType ?? "unknown");
  const kind = normalizeKind(command, normalized.eventType);
  const trustedPayment = trustedPaymentFromRaw(kind, raw, input);

  const rawText =
    input.text ??
    normalized.text ??
    normalized.comment ??
    extractBilibiliDanmakuText(raw) ??
    extractBilibiliDataText(raw) ??
    extractYoutubeText(raw) ??
    extractTikTokText(raw) ??
    raw.text ??
    raw.comment ??
    raw.message ??
    "";

  const text = sanitizeExternalText(String(rawText));
  const user = normalizeUser(input, normalized, raw);

  return {
    id: String(input.id ?? raw.id ?? `live-event-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    platformEventId: stringOrUndefined(input.platformEventId ?? normalized.platformEventId),
    fingerprint: stringOrUndefined(input.fingerprint ?? normalized.fingerprint),
    source: enumValue(input.source, ["bilibili", "twitch", "youtube", "tiktok", "fixture", "debug"] as const, "debug"),
    kind,
    priority: normalizePriority(input.priority, trustedPayment, kind),
    receivedAt: Number(input.receivedAt ?? raw.receivedAt ?? Date.now()),
    roomId: stringOrUndefined(input.roomId ?? raw.room_id ?? raw.roomId),
    user,
    text: truncateText(text, 500),
    trustedPayment,
    rawCommand: command,
    raw,
  };
}

/**
 * Applies hard platform policy and moderation rules.
 */
export function moderateLiveEvent(event: NormalizedLiveEvent): LiveModerationResult {
  if (!event.text.trim() && event.kind === "danmaku") {
    return { allowed: false, action: "drop", reason: "empty danmaku", category: "empty", visibleToControlRoom: false };
  }
  return moderateLiveText(event.text);
}

/**
 * Moderates live output text.
 */
export function moderateLiveOutputText(text: string): LiveModerationResult {
  return moderateLiveText(text);
}

/**
 * Formats a normalized event for use in LLM prompts.
 */
export function formatLiveEventForPrompt(event: NormalizedLiveEvent): string {
  const parts = [
    `id: ${event.id}`,
    `source: ${event.source}`,
    `kind: ${event.kind}`,
    `trusted_priority: ${event.priority}`,
    `user: ${event.user?.name ?? "unknown"} (${event.user?.id ?? "unknown"})`,
  ];

  if (event.trustedPayment) {
    const { rawType, amount, currency, giftName } = event.trustedPayment;
    parts.push(`trusted_payment: ${rawType} ${amount ?? "unknown"} ${currency ?? ""} ${giftName ?? ""}`.trim());
  } else {
    parts.push("trusted_payment: none");
  }

  parts.push(`text: ${event.text || "(empty)"}`);
  return parts.join("\n");
}

// === Helpers ===

function moderateLiveText(text: string): LiveModerationResult {
  const check = (
    patterns: RegExp[],
    category: LiveModerationResult["category"],
    action: LiveModerationResult["action"],
    reason: string,
  ): LiveModerationResult | null => {
    if (patterns.some((p) => p.test(text))) {
      return { allowed: false, action, reason, category, visibleToControlRoom: true };
    }
    return null;
  };

  return (
    check(MINOR_SAFETY_PATTERNS, "minor_safety", "drop", "minor safety risk") ??
    check(PRIVACY_PATTERNS, "privacy", "drop", "privacy or doxxing risk") ??
    check(PROMPT_INJECTION_PATTERNS, "prompt_injection", "drop", "prompt injection attempt") ??
    check(ABUSE_PATTERNS, "abuse", "hide", "abusive text") ??
    check(SEXUAL_PATTERNS, "sexual", "drop", "sexual content") ??
    check(SPAM_PATTERNS, "spam", "drop", "spam text") ??
    (containsPoliticalContent(text)
      ? {
          allowed: false,
          action: "drop",
          reason: "political content",
          category: "political",
          visibleToControlRoom: true,
        }
      : { allowed: true, action: "allow", reason: "allowed", visibleToControlRoom: false })
  );
}

function normalizeKind(command: string, explicitKind: unknown): LiveEventKind {
  const value = String(explicitKind ?? command).toUpperCase();
  if (
    value.includes("ENTRANCE") ||
    value.includes("JOIN") ||
    value.includes("INTERACT_WORD") ||
    value.includes("MEMBER")
  )
    return "entrance";
  if (value.includes("FOLLOW")) return "follow";
  if (value.includes("DANMU")) return "danmaku";
  if (value.includes("SUPER_CHAT") || value.includes("SUPERCHAT")) return "super_chat";
  if (value.includes("SEND_GIFT") || value.includes("GIFT")) return "gift";
  if (
    value.includes("GUARD") ||
    value.includes("SPONSOR") ||
    value.includes("SUB") ||
    value.includes("MEMBERSHIP") ||
    value.includes("舰长")
  )
    return "guard";
  if (value.includes("LIKE")) return "like";
  if (value.includes("SYSTEM")) return "system";
  return "unknown";
}

function normalizePriority(
  rawPriority: unknown,
  trustedPayment: NormalizedLiveEvent["trustedPayment"],
  kind: LiveEventKind,
): LiveEventPriority {
  if (trustedPayment?.rawType === "super_chat" || trustedPayment?.rawType === "guard") return "high";
  if (trustedPayment?.rawType === "gift") return "medium";
  if (["entrance", "follow", "like"].includes(kind)) return "low";
  if (kind === "system") return "medium";
  return enumValue(rawPriority, ["low", "medium", "high"] as const, "low");
}

function trustedPaymentFromRaw(
  kind: LiveEventKind,
  raw: Record<string, unknown>,
  input: Record<string, unknown>,
): NormalizedLiveEvent["trustedPayment"] {
  if (!["super_chat", "gift", "guard"].includes(kind)) return undefined;

  const data = asRecord(raw.data ?? input.data ?? raw.gift ?? raw.snippet);
  const snippet = asRecord(raw.snippet);
  const superChat = asRecord(snippet.superChatDetails);
  const superSticker = asRecord(snippet.superStickerDetails);

  return {
    rawType: kind as "super_chat" | "gift" | "guard",
    amount: numberOrUndefined(
      data.price ??
        data.amount ??
        data.amountMicros ??
        superChat.amountMicros ??
        superSticker.amountMicros ??
        input.amount,
    ),
    currency: stringOrUndefined(
      data.currency ?? superChat.currency ?? superSticker.currency ?? input.currency ?? "CNY",
    ),
    giftName: stringOrUndefined(data.giftName ?? data.gift_name ?? data.name ?? input.giftName),
  };
}

function normalizeUser(
  input: Record<string, unknown>,
  normalized: Record<string, unknown>,
  raw: Record<string, unknown>,
): NormalizedLiveEvent["user"] | undefined {
  const info = raw.info;
  const bilibiliUser = Array.isArray(info) ? info[2] : undefined;
  const author = asRecord(raw.authorDetails);
  const user = asRecord(raw.user);
  const data = asRecord(raw.data);
  const userInfo = asRecord(data.user_info);

  const id =
    input.userId ??
    normalized.userId ??
    raw.uid ??
    data.uid ??
    author.channelId ??
    user.uniqueId ??
    user.id ??
    (Array.isArray(bilibiliUser) ? bilibiliUser[0] : undefined);
  const name =
    input.userName ??
    normalized.userName ??
    raw.uname ??
    data.uname ??
    userInfo.uname ??
    author.displayName ??
    user.nickname ??
    user.uniqueId ??
    (Array.isArray(bilibiliUser) ? bilibiliUser[1] : undefined);

  if (id === undefined && name === undefined) return undefined;
  return { id: stringOrUndefined(id), name: stringOrUndefined(name) };
}

function extractBilibiliDanmakuText(raw: Record<string, unknown>): string | undefined {
  const info = raw.info;
  return Array.isArray(info) && typeof info[1] === "string" ? info[1] : undefined;
}

function extractBilibiliDataText(raw: Record<string, unknown>): string | undefined {
  const data = asRecord(raw.data);
  return stringOrUndefined(data.message ?? data.giftName ?? data.gift_name ?? data.uname);
}

function extractYoutubeText(raw: Record<string, unknown>): string | undefined {
  const snippet = asRecord(raw.snippet);
  return stringOrUndefined(snippet.displayMessage ?? asRecord(snippet.textMessageDetails).messageText);
}

function extractTikTokText(raw: Record<string, unknown>): string | undefined {
  const data = asRecord(raw.data ?? raw);
  return stringOrUndefined(data.comment ?? data.text ?? data.giftName ?? data.gift_name);
}

function containsPoliticalContent(text: string): boolean {
  return POLITICAL_PATTERNS.some((pattern) => pattern.test(text));
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  return undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
}
