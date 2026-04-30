import { createHash } from "node:crypto";
import type { LiveEventKind, LiveEventSource, NormalizedLiveEvent } from "../../utils/live_event.js";

export interface LiveEventIdentity {
  id: string;
  platformEventId?: string;
  fingerprint: string;
}

export interface LiveEventIdentityInput {
  platform: LiveEventSource;
  roomId?: string;
  kind: LiveEventKind;
  platformEventId?: string;
  userId?: string;
  userName?: string;
  text?: string;
  amount?: number;
  receivedAt: number;
}

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

export function applyLiveEventIdentity(event: NormalizedLiveEvent, platformEventId = event.platformEventId): NormalizedLiveEvent {
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

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  return text || undefined;
}
