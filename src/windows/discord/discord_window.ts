import type { PerceptualEvent } from "../../core/protocol/perceptual_event.js";
import type { Intent } from "../../core/protocol/intent.js";
import type { RuntimeConfig } from "../../config/index.js";
import { DiscordRuntime, type DiscordMessageSummary } from "../../windows/discord/runtime.js";
import type { StelleEventBus } from "../../core/event/event_bus.js";

export interface DiscordWindowOptions {
  config: RuntimeConfig;
  discord: DiscordRuntime;
  events: StelleEventBus;
  logger: Pick<Console, "info" | "warn" | "error">;
}

export class DiscordWindow {
  private unsubscribe?: () => void;
  private intentUnsubscribe?: () => void;

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
    if (this.options.config.discord.token) {
      await this.options.discord.login(this.options.config.discord.token);
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
    const event = discordMessageToPerceptualEvent(message);
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
    const payload = (intent.payload ?? {}) as { text?: unknown; channelId?: unknown; replyToMessageId?: unknown };
    const channelId = String(payload.channelId ?? "");
    const text = String(payload.text ?? "").trim();
    if (!channelId || !text) return;
    await this.options.discord.sendMessage({
      channelId,
      content: text,
      replyToMessageId: String(payload.replyToMessageId ?? ""),
    });
  }
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

function discordMessageToPerceptualEvent(message: DiscordMessageSummary): PerceptualEvent {
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
      trust: { owner: message.author.isBotOwner === true },
    },
    metadata: {
      platform: "discord",
      guildId: message.guildId,
      direct: message.isDirectMessage === true,
      mentioned: message.isMentioned === true,
    },
  };
}
