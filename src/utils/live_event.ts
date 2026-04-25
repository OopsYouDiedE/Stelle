/**
 * Module: Live event normalization and hard moderation
 *
 * Runtime flow:
 * - Convert Bilibili/tiny-bilibili-ws/debug fixture payloads into one internal
 *   `NormalizedLiveEvent` shape before they reach LiveCursor prompts.
 * - Apply hard platform policy before LLM routing. Political/current-affairs
 *   content is dropped here and never enters the model, queue, or memory.
 * - Keep payment priority tied to trusted event metadata only; user text can
 *   never upgrade event priority.
 *
 * Main methods:
 * - `normalizeLiveEvent()`: accepts raw external payloads and returns safe event
 *   metadata plus text.
 * - `moderateLiveEvent()`: hard drop/hide decisions that must not be delegated
 *   to the LLM.
 * - `formatLiveEventForPrompt()`: compact prompt block for the first route LLM.
 */
import { asRecord, enumValue } from "./json.js";
import { sanitizeExternalText, truncateText } from "./text.js";

export type LiveEventSource = "bilibili" | "fixture" | "debug";
export type LiveEventKind = "danmaku" | "super_chat" | "gift" | "guard" | "like" | "system" | "unknown";
export type LiveEventPriority = "low" | "medium" | "high";

export interface NormalizedLiveEvent {
  id: string;
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
  rawCommand?: string;
  raw?: unknown;
}

export interface LiveModerationResult {
  allowed: boolean;
  action: "allow" | "drop" | "hide";
  reason: string;
  category?: "political" | "spam" | "empty";
}

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

export function normalizeLiveEvent(input: Record<string, unknown>): NormalizedLiveEvent {
  const raw = "raw" in input ? input.raw : input;
  const normalized = asRecord(input.normalized);
  const rawRecord = asRecord(raw);
  const command = String(input.cmd ?? rawRecord.cmd ?? normalized.eventType ?? "unknown");
  const kind = normalizeKind(command, normalized.eventType);
  const trustedPayment = trustedPaymentFromRaw(kind, rawRecord, input);
  const text = sanitizeExternalText(
    String(
      input.text ??
        normalized.text ??
        extractBilibiliDanmakuText(rawRecord) ??
        rawRecord.text ??
        rawRecord.message ??
        ""
    )
  );
  const user = normalizeUser(input, normalized, rawRecord);

  return {
    id: String(input.id ?? rawRecord.id ?? `live-event-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    source: enumValue(input.source, ["bilibili", "fixture", "debug"] as const, "debug"),
    kind,
    priority: normalizePriority(input.priority, trustedPayment, kind),
    receivedAt: Number(input.receivedAt ?? rawRecord.receivedAt ?? Date.now()),
    roomId: stringOrUndefined(input.roomId ?? rawRecord.room_id ?? rawRecord.roomId),
    user,
    text: truncateText(text, 500),
    trustedPayment,
    rawCommand: command,
    raw,
  };
}

export function moderateLiveEvent(event: NormalizedLiveEvent): LiveModerationResult {
  if (!event.text.trim() && event.kind === "danmaku") {
    return { allowed: false, action: "drop", reason: "empty danmaku", category: "empty" };
  }
  if (containsPoliticalContent(event.text)) {
    return { allowed: false, action: "drop", reason: "political/current-affairs content is ignored on Bilibili live", category: "political" };
  }
  return { allowed: true, action: "allow", reason: "allowed" };
}

export function formatLiveEventForPrompt(event: NormalizedLiveEvent): string {
  return [
    `id: ${event.id}`,
    `source: ${event.source}`,
    `kind: ${event.kind}`,
    `trusted_priority: ${event.priority}`,
    `user: ${event.user?.name ?? "unknown"} (${event.user?.id ?? "unknown"})`,
    event.trustedPayment
      ? `trusted_payment: ${event.trustedPayment.rawType} ${event.trustedPayment.amount ?? "unknown"} ${event.trustedPayment.currency ?? ""} ${event.trustedPayment.giftName ?? ""}`.trim()
      : "trusted_payment: none",
    `text: ${event.text || "(empty)"}`,
  ].join("\n");
}

function normalizeKind(command: string, explicitKind: unknown): LiveEventKind {
  const value = String(explicitKind ?? command).toUpperCase();
  if (value.includes("DANMU")) return "danmaku";
  if (value.includes("SUPER_CHAT") || value.includes("SUPERCHAT")) return "super_chat";
  if (value.includes("SEND_GIFT") || value.includes("GIFT")) return "gift";
  if (value.includes("GUARD") || value.includes("舰长")) return "guard";
  if (value.includes("LIKE")) return "like";
  if (value.includes("SYSTEM")) return "system";
  return "unknown";
}

function normalizePriority(rawPriority: unknown, trustedPayment: NormalizedLiveEvent["trustedPayment"], kind: LiveEventKind): LiveEventPriority {
  if (trustedPayment?.rawType === "super_chat" || trustedPayment?.rawType === "guard") return "high";
  if (trustedPayment?.rawType === "gift") return "medium";
  if (kind === "system") return "medium";
  return enumValue(rawPriority, ["low", "medium", "high"] as const, "low");
}

function trustedPaymentFromRaw(kind: LiveEventKind, raw: Record<string, unknown>, input: Record<string, unknown>): NormalizedLiveEvent["trustedPayment"] {
  if (kind !== "super_chat" && kind !== "gift" && kind !== "guard") return undefined;
  const data = asRecord(raw.data ?? input.data);
  return {
    rawType: kind === "super_chat" ? "super_chat" : kind === "guard" ? "guard" : "gift",
    amount: numberOrUndefined(data.price ?? data.amount ?? input.amount),
    currency: stringOrUndefined(data.currency ?? "CNY"),
    giftName: stringOrUndefined(data.giftName ?? data.gift_name ?? input.giftName),
  };
}

function normalizeUser(input: Record<string, unknown>, normalized: Record<string, unknown>, raw: Record<string, unknown>): NormalizedLiveEvent["user"] | undefined {
  const info = raw.info;
  const bilibiliUser = Array.isArray(info) ? info[2] : undefined;
  const id = input.userId ?? normalized.userId ?? raw.uid ?? (Array.isArray(bilibiliUser) ? bilibiliUser[0] : undefined);
  const name = input.userName ?? normalized.userName ?? raw.uname ?? (Array.isArray(bilibiliUser) ? bilibiliUser[1] : undefined);
  if (id === undefined && name === undefined) return undefined;
  return { id: stringOrUndefined(id), name: stringOrUndefined(name) };
}

function extractBilibiliDanmakuText(raw: Record<string, unknown>): string | undefined {
  const info = raw.info;
  return Array.isArray(info) && typeof info[1] === "string" ? info[1] : undefined;
}

function containsPoliticalContent(text: string): boolean {
  return POLITICAL_PATTERNS.some((pattern) => pattern.test(text));
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : typeof value === "number" ? String(value) : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}
