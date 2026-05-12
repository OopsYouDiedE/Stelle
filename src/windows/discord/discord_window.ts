import { loadDiscordConfig } from "./config.js";
import type { PerceptualEvent } from "../../core/protocol/perceptual_event.js";
import type { Intent } from "../../core/protocol/intent.js";
import { DiscordRuntime, type DiscordMessageSummary } from "../../windows/discord/runtime.js";
import type { StelleEventBus } from "../../core/event/event_bus.js";

export interface DiscordWindowOptions {
  config: any;
  discord: DiscordRuntime;
  events: StelleEventBus;
  logger: Pick<Console, "info" | "warn" | "error">;
}

export class DiscordWindow {
  private unsubscribe?: () => void;
  private intentUnsubscribe?: () => void;
  private readonly activeUntilByChannel = new Map<string, number>();

  constructor(private readonly options: DiscordWindowOptions) {}

  async start(): Promise<void> {
    this.unsubscribe = this.options.discord.onMessage((message) => this.receiveMessage(message));
    this.intentUnsubscribe = this.options.events.subscribe("cognition.intent", (event) => {
      const intent = isIntent(event.payload) ? event.payload : undefined;
      if (!intent) return;
      void this.receiveIntent(intent).catch((error) => {
        this.options.logger.error("DiscordWindow failed to handle cognition intent", error);
      });
    });
    const config = loadDiscordConfig(this.options.config.rawYaml);
    if (config.token) {
      await this.options.discord.login(config.token);
      await this.options.discord.setBotPresence({ window: "window.discord", detail: "runtime" }).catch(() => undefined);
    }
    this.options.logger.info("Discord Window started");
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.intentUnsubscribe?.();
    this.unsubscribe = undefined;
    this.intentUnsubscribe = undefined;
    await this.options.discord.destroy();
    this.options.logger.info("Discord Window stopped");
  }

  async receiveMessage(message: DiscordMessageSummary): Promise<void> {
    if (message.author.bot) return;
    const config = loadDiscordConfig(this.options.config.rawYaml);
    const route = this.decideRoute(message, config);
    if (route.dismissed) {
      this.activeUntilByChannel.delete(message.channelId);
      return;
    }
    if (!route.route) return;
    this.refreshActiveSession(message, config);
    const event = discordMessageToPerceptualEvent(message, route);
    this.options.events.publish({
      type: "perceptual.event",
      source: "window.discord",
      payload: event,
    } as never);
  }

  async receiveIntent(intent: Intent): Promise<void> {
    if (intent.type !== "respond") return;
    const payload = (intent.payload ?? {}) as { sourceWindow?: unknown };
    if (payload.sourceWindow !== "window.discord") return;
    await this.sendIntent(intent);
  }

  snapshot() {
    return this.options.discord.getStatusSync();
  }

  private async sendIntent(intent: Intent): Promise<void> {
    const payload = (intent.payload ?? {}) as {
      text?: unknown;
      channelId?: unknown;
      replyToMessageId?: unknown;
      discordReplyMode?: unknown;
    };
    const config = loadDiscordConfig(this.options.config.rawYaml);
    const channelId = String(payload.channelId ?? "");
    const text = String(payload.text ?? "").trim().slice(0, config.maxReplyChars);
    if (!channelId || !text) return;
    const replyToMessageId =
      payload.discordReplyMode === "reply" && typeof payload.replyToMessageId === "string"
        ? payload.replyToMessageId
        : undefined;
    await this.options.discord.sendMessage({
      channelId,
      content: text,
      replyToMessageId,
    });
  }

  private decideRoute(
    message: DiscordMessageSummary,
    config: ReturnType<typeof loadDiscordConfig>,
  ): DiscordRouteDecision {
    const now = message.createdTimestamp || Date.now();
    const activeUntil = this.activeUntilByChannel.get(message.channelId) ?? 0;
    const active = activeUntil > now;
    if (!active && activeUntil) this.activeUntilByChannel.delete(message.channelId);

    const summoned = isSummonMessage(message);
    const dismissed = (summoned || active) && isDismissalMessage(message);
    return {
      route: summoned || (config.ambientEnabled && active),
      summoned,
      active,
      dismissed,
    };
  }

  private refreshActiveSession(message: DiscordMessageSummary, config: ReturnType<typeof loadDiscordConfig>): void {
    const stayMs = Math.max(1, config.cooldownSeconds) * 1000;
    this.activeUntilByChannel.set(message.channelId, (message.createdTimestamp || Date.now()) + stayMs);
  }
}

interface DiscordRouteDecision {
  route: boolean;
  summoned: boolean;
  active: boolean;
  dismissed: boolean;
}

function isSummonMessage(message: DiscordMessageSummary): boolean {
  if (message.isDirectMessage) return true;
  if (message.isMentioned) return true;
  if (message.author.isBotOwner) return true;
  return false;
}

function isDismissalMessage(message: DiscordMessageSummary): boolean {
  const text = `${message.cleanContent ?? ""} ${message.content ?? ""}`.trim();
  return /(不用了|没事了|可以了|先这样|你可以走了|退下|不用回|不用回复|先退|结束驻留)/i.test(text);
}

function isIntent(value: unknown): value is Intent {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { type?: unknown }).type === "string",
  );
}

function discordMessageToPerceptualEvent(message: DiscordMessageSummary, route: DiscordRouteDecision): PerceptualEvent {
  return {
    id: `discord_${message.id}`,
    type: "text.message",
    sourceWindow: "window.discord",
    actorId: message.author.id,
    sessionId: message.channelId,
    timestamp: message.createdTimestamp,
    salienceHint: message.isDirectMessage || message.isMentioned ? 0.9 : 0.25,
    payload: {
      text: message.cleanContent || message.content,
      actor: message.author,
      channelId: message.channelId,
      replyToMessageId: message.id,
      discordReplyMode: message.isMentioned ? "reply" : "send",
      summoned: route.summoned,
      activeSession: route.active,
      trust: { owner: message.author.isBotOwner === true },
    },
    metadata: {
      platform: "discord",
      guildId: message.guildId,
      direct: message.isDirectMessage === true,
      mentioned: message.isMentioned === true,
      summoned: route.summoned,
      activeSession: route.active,
    },
  };
}
