import type { RuntimeConfig } from "../utils/config_loader.js";
import type { StelleEventBus } from "../utils/event_bus.js";
import { normalizeLiveEvent, type NormalizedLiveEvent } from "../utils/live_event.js";
import type { StageOutputArbiter } from "../stage/output_arbiter.js";
import type { OutputIntent } from "../stage/output_types.js";
import { sanitizeExternalText, truncateText } from "../utils/text.js";

export interface LiveEngagementServiceDeps {
  config: RuntimeConfig;
  eventBus: StelleEventBus;
  stageOutput: StageOutputArbiter;
  now: () => number;
}

export class LiveEngagementService {
  private unsubscribes: (() => void)[] = [];
  private lastActivityAt: number;
  private lastIdleOutputAt = 0;
  private readonly lastThanksAt = new Map<string, number>();
  private readonly scheduleLastRunAt = new Map<string, number>();

  constructor(private readonly deps: LiveEngagementServiceDeps) {
    this.lastActivityAt = deps.now();
  }

  start(): void {
    this.unsubscribes.push(this.deps.eventBus.subscribe("live.event.received", (event) => {
      void this.handleLiveEvent(event.payload).catch(error => console.error("[LiveEngagement] event failed:", error));
    }));
    this.unsubscribes.push(this.deps.eventBus.subscribe("live.tick", () => {
      void this.handleTick().catch(error => console.error("[LiveEngagement] tick failed:", error));
    }));
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
  }

  private async handleLiveEvent(payload: Record<string, unknown>): Promise<void> {
    const event = normalizeLiveEvent(payload);
    this.lastActivityAt = this.deps.now();
    if (!this.deps.config.live.thanks.enabled) return;

    const text = this.thanksText(event);
    if (!text) return;
    const key = `${event.kind}:${event.user?.id ?? event.user?.name ?? "unknown"}:${event.trustedPayment?.giftName ?? ""}`;
    const cooldownMs = this.deps.config.live.thanks.cooldownSeconds * 1000;
    const lastAt = this.lastThanksAt.get(key) ?? 0;
    if (this.deps.now() - lastAt < cooldownMs) return;
    this.lastThanksAt.set(key, this.deps.now());

    await this.propose({
      sourceEventId: event.id,
      lane: "direct_response",
      priority: event.kind === "super_chat" || event.kind === "guard" ? 75 : event.kind === "gift" ? 65 : 50,
      salience: event.kind === "super_chat" || event.kind === "guard" ? "high" : "medium",
      text,
      ttlMs: 15_000,
      interrupt: event.kind === "super_chat" || event.kind === "guard" ? "soft" : "none",
      metadata: { source: "engagement_thanks", eventKind: event.kind, platform: event.source },
    });
  }

  private async handleTick(): Promise<void> {
    await this.handleIdle();
    await this.handleSchedule();
  }

  private async handleIdle(): Promise<void> {
    const idle = this.deps.config.live.idle;
    if (!idle.enabled || idle.templates.length === 0) return;
    const now = this.deps.now();
    if (now - this.lastActivityAt < idle.minQuietSeconds * 1000) return;
    if (now - this.lastIdleOutputAt < idle.cooldownSeconds * 1000) return;
    this.lastIdleOutputAt = now;
    this.lastActivityAt = now;

    await this.propose({
      lane: "topic_hosting",
      priority: 42,
      salience: "low",
      text: renderTemplate(pick(idle.templates), this.variables()),
      ttlMs: 30_000,
      interrupt: "none",
      metadata: { source: "idle_task" },
    });
  }

  private async handleSchedule(): Promise<void> {
    const schedule = this.deps.config.live.schedule;
    if (!schedule.enabled) return;
    const now = this.deps.now();
    for (const item of schedule.items) {
      if (!item.enabled || item.templates.length === 0) continue;
      const lastAt = this.scheduleLastRunAt.get(item.id) ?? 0;
      if (lastAt && now - lastAt < item.intervalSeconds * 1000) continue;
      if (!lastAt) {
        this.scheduleLastRunAt.set(item.id, now);
        continue;
      }
      this.scheduleLastRunAt.set(item.id, now);
      await this.propose({
        lane: "topic_hosting",
        priority: 48,
        salience: "low",
        text: renderTemplate(pick(item.templates), this.variables()),
        ttlMs: 30_000,
        interrupt: "none",
        metadata: { source: "schedule_task", scheduleId: item.id },
      });
    }
  }

  private thanksText(event: NormalizedLiveEvent): string | undefined {
    const thanks = this.deps.config.live.thanks;
    const amount = event.trustedPayment?.amount ?? 0;
    if ((event.kind === "gift" || event.kind === "super_chat") && amount < thanks.giftLowestAmount) return undefined;

    const templates = event.kind === "entrance" ? thanks.entranceTemplates
      : event.kind === "follow" ? thanks.followTemplates
      : event.kind === "gift" ? thanks.giftTemplates
      : event.kind === "guard" ? thanks.guardTemplates
      : event.kind === "super_chat" ? thanks.superChatTemplates
      : [];
    if (!templates.length) return undefined;

    const username = truncateText(sanitizeExternalText(event.user?.name ?? "观众"), thanks.usernameMaxLen);
    return renderTemplate(pick(templates), {
      ...this.variables(),
      username,
      platform: event.source,
      comment: event.text,
      gift_name: event.trustedPayment?.giftName ?? (event.text || "礼物"),
      amount: event.trustedPayment?.amount ?? "",
      currency: event.trustedPayment?.currency ?? "",
    });
  }

  private variables(): Record<string, string | number> {
    const now = new Date();
    return {
      time: now.toLocaleTimeString("zh-CN", { hour12: false }),
    };
  }

  private async propose(input: Omit<OutputIntent, "id" | "cursorId" | "output">): Promise<void> {
    const text = sanitizeExternalText(input.text).trim();
    if (!text) return;
    await this.deps.stageOutput.propose({
      ...input,
      id: `live-engagement-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      cursorId: "live_engagement",
      text,
      summary: text,
      output: {
        caption: true,
        tts: Boolean(this.deps.config.live.ttsEnabled),
      },
    });
  }
}

function pick(values: string[]): string {
  return values[Math.floor(Math.random() * values.length)] ?? "";
}

function renderTemplate(template: string, variables: Record<string, string | number>): string {
  const randomized = template.replace(/\[([^\[\]]+)\]/g, (_match, content: string) => {
    const options = content.split("|").map(item => item.trim()).filter(Boolean);
    return options.length ? pick(options) : content;
  });
  return randomized.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    const value = variables[key];
    return value === undefined ? match : String(value);
  });
}
