// === Imports ===
import { mkdir, readFile, rm, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { sanitizeExternalText, truncateText } from "../../../utils/text.js";

// === Types & Interfaces ===
export type ViewerPlatform = string;
export type ViewerInteractionKind =
  | "text"
  | "gift"
  | "super_chat"
  | "guard"
  | "entrance"
  | "follow"
  | "like"
  | "system"
  | "unknown";

export interface ViewerInteractionEvent {
  id: string;
  source: ViewerPlatform;
  kind: ViewerInteractionKind;
  priority?: "low" | "medium" | "high";
  receivedAt: number;
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
}

export interface ViewerProfile {
  platform: ViewerPlatform;
  viewerId: string;
  displayName?: string;
  aliases: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  interactionCount: number;
  recentMessages: Array<{ timestamp: number; text: string }>;
  roles: string[];
  paymentStats: {
    giftCount: number;
    superChatCount: number;
    guardCount: number;
    totalAmount: number;
    currencies: Record<string, number>;
  };
  preferenceNotes: string[];
  riskNotes: string[];
  thanksCooldowns: Record<string, number>;
  retentionExpiresAt: number;
}

export interface ViewerProfileSummary {
  platform: ViewerPlatform;
  viewerId: string;
  displayName?: string;
  interactionCount: number;
  roles: string[];
  paymentStats: ViewerProfile["paymentStats"];
  recentMessages: string[];
  relationshipHint: string;
}

// === Main Class: ViewerProfileStore ===
export class ViewerProfileStore {
  constructor(
    private readonly rootDir = path.resolve("memory/live/viewers"),
    private readonly retentionMs = 180 * 24 * 3600 * 1000,
  ) {}

  // === Public API ===

  async updateFromEvent(event: ViewerInteractionEvent): Promise<ViewerProfile | undefined> {
    const viewerId = stableViewerId(event);
    if (!viewerId) return undefined;
    const now = event.receivedAt || Date.now();
    const existing = await this.read(event.source, viewerId);
    const profile = existing ?? emptyProfile(event.source, viewerId, now, now + this.retentionMs);
    const name = sanitizeExternalText(event.user?.name ?? "").trim();
    if (name) {
      profile.displayName = name;
      if (!profile.aliases.includes(name)) profile.aliases.push(name);
      profile.aliases = profile.aliases.slice(-8);
    }
    profile.lastSeenAt = now;
    profile.retentionExpiresAt = now + this.retentionMs;
    profile.interactionCount += 1;
    updateRoles(profile, event);
    updatePayments(profile, event);
    if (event.text.trim() && event.kind === "text") {
      profile.recentMessages.push({ timestamp: now, text: truncateText(sanitizeExternalText(event.text), 160) });
      profile.recentMessages = profile.recentMessages.slice(-8);
    }
    await this.write(profile);
    return profile;
  }

  async read(platform: ViewerPlatform, viewerId: string): Promise<ViewerProfile | null> {
    const raw = await readFile(this.filePath(platform, viewerId), "utf8").catch(() => null);
    return raw ? (JSON.parse(raw) as ViewerProfile) : null;
  }

  async summarize(platform: ViewerPlatform, viewerId: string): Promise<ViewerProfileSummary | null> {
    const profile = await this.read(platform, viewerId);
    return profile ? summarizeProfile(profile) : null;
  }

  async summariesForEvents(events: ViewerInteractionEvent[], limit = 5): Promise<ViewerProfileSummary[]> {
    const seen = new Set<string>();
    const uniqueKeys: Array<{ platform: ViewerPlatform; viewerId: string }> = [];

    for (const event of events) {
      const viewerId = stableViewerId(event);
      if (!viewerId) continue;
      const key = `${event.source}:${viewerId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueKeys.push({ platform: event.source, viewerId });
      if (uniqueKeys.length >= limit) break;
    }

    const summaries = await Promise.all(uniqueKeys.map((k) => this.summarize(k.platform, k.viewerId)));

    return summaries.filter((s): s is ViewerProfileSummary => s !== null);
  }

  // === Persistence Logic ===

  async write(profile: ViewerProfile): Promise<void> {
    const file = this.filePath(profile.platform, profile.viewerId);
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
    await rename(temp, file);
  }

  async delete(platform: ViewerPlatform, viewerId: string): Promise<boolean> {
    const file = this.filePath(platform, viewerId);
    const existed = Boolean(await readFile(file, "utf8").catch(() => null));
    await rm(file, { force: true });
    return existed;
  }

  filePath(platform: ViewerPlatform, viewerId: string): string {
    return path.join(this.rootDir, safeSegment(platform), `${safeSegment(viewerId)}.json`);
  }
}

// === Profile State Helpers ===

export function stableViewerId(event: ViewerInteractionEvent): string | undefined {
  return event.user?.id || event.user?.name;
}

function emptyProfile(
  platform: ViewerPlatform,
  viewerId: string,
  now: number,
  retentionExpiresAt: number,
): ViewerProfile {
  return {
    platform,
    viewerId,
    aliases: [],
    firstSeenAt: now,
    lastSeenAt: now,
    interactionCount: 0,
    recentMessages: [],
    roles: [],
    paymentStats: { giftCount: 0, superChatCount: 0, guardCount: 0, totalAmount: 0, currencies: {} },
    preferenceNotes: [],
    riskNotes: [],
    thanksCooldowns: {},
    retentionExpiresAt,
  };
}

function updateRoles(profile: ViewerProfile, event: ViewerInteractionEvent): void {
  const roles = new Set(profile.roles);
  if (event.kind === "guard") roles.add("guard");
  if (event.kind === "super_chat") roles.add("supporter");
  if (event.kind === "gift") roles.add("gifter");
  if (event.kind === "follow") roles.add("follower");
  if (profile.interactionCount >= 5) roles.add("regular");
  profile.roles = Array.from(roles).sort();
}

function updatePayments(profile: ViewerProfile, event: ViewerInteractionEvent): void {
  const payment = event.trustedPayment;
  if (!payment) return;
  if (payment.rawType === "gift") profile.paymentStats.giftCount += 1;
  if (payment.rawType === "super_chat") profile.paymentStats.superChatCount += 1;
  if (payment.rawType === "guard") profile.paymentStats.guardCount += 1;
  const amount = payment.amount ?? 0;
  profile.paymentStats.totalAmount += amount;
  const currency = payment.currency ?? "unknown";
  profile.paymentStats.currencies[currency] = (profile.paymentStats.currencies[currency] ?? 0) + amount;
}

// === Profile Summary Logic ===

function summarizeProfile(profile: ViewerProfile): ViewerProfileSummary {
  const relationshipHint =
    [
      profile.roles.includes("regular") ? "常客" : undefined,
      profile.roles.includes("guard") ? "舰长/会员支持者" : undefined,
      profile.roles.includes("supporter") ? "曾发付费留言" : undefined,
      profile.interactionCount > 1 ? `互动 ${profile.interactionCount} 次` : undefined,
    ]
      .filter(Boolean)
      .join("，") || "新观众";
  return {
    platform: profile.platform,
    viewerId: profile.viewerId,
    displayName: profile.displayName,
    interactionCount: profile.interactionCount,
    roles: [...profile.roles],
    paymentStats: { ...profile.paymentStats, currencies: { ...profile.paymentStats.currencies } },
    recentMessages: profile.recentMessages.slice(-3).map((item) => item.text),
    relationshipHint,
  };
}

// === Pathing & Safety Utils ===

function safeSegment(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f\s]+/g, "-") || "unknown";
}
