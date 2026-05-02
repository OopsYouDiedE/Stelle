// === Imports ===
import { createHash } from "node:crypto";
import type {
  TextIngressEvent,
  TextIngressKind,
  TextIngressSource,
} from "../../../core/protocol/text_ingress_event.js";

// === Types ===
export interface LiveEventIdentity {
  id: string;
  platformEventId?: string;
  fingerprint: string;
}

export interface LiveEventIdentityInput {
  platform: TextIngressSource;
  roomId?: string;
  kind: TextIngressKind;
  platformEventId?: string;
  userId?: string;
  userName?: string;
  text?: string;
  amount?: number;
  receivedAt: number;
}

// === Core Logic ===
export function buildLiveEventIdentity(input: LiveEventIdentityInput): LiveEventIdentity {
  const platformEventId = clean(input.platformEventId);
  const roomId = input.roomId ?? "unknown";
  const timeBucket = Math.floor(input.receivedAt / 1000);
  const fingerprintBase = [
    input.platform,
    input.roomId ?? "",
    input.kind,
    platformEventId ?? "",
    input.userId ?? input.userName ?? "",
    normalizeText(input.text ?? ""),
    input.amount ?? "",
    timeBucket,
  ].join("|");

  const fingerprint = createHash("sha1").update(fingerprintBase).digest("hex").slice(0, 16);
  const id = platformEventId
    ? `${input.platform}:${roomId}:${input.kind}:${platformEventId}`
    : `${input.platform}:${roomId}:${input.kind}:${fingerprint}`;

  return { id, platformEventId, fingerprint };
}

export function applyLiveEventIdentity<T extends Record<string, any>>(
  event: T,
  platformEventId = event.platformEventId,
): T {
  const identity = buildLiveEventIdentity({
    platform: event.source,
    roomId: event.roomId,
    kind: event.kind,
    platformEventId,
    userId: event.user?.id,
    userName: event.user?.name,
    text: event.text,
    amount: event.trustedPayment?.amount,
    receivedAt: event.receivedAt,
  });
  return { ...event, ...identity };
}

// === Helpers ===
function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  return text || undefined;
}
