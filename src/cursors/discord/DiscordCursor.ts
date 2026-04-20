import type { Message, Typing } from "discord.js";
import type { CursorActivation, CursorReport } from "../base.js";
import type {
  DiscordActivation,
  DiscordCursor,
  DiscordCursorContext,
  DiscordSnapshot,
} from "./types.js";
import type { DiscordChannelSnapshot } from "./runtime.js";

export interface DiscordCursorOptions {
  id?: string;
  onMessage: (message: Message) => Promise<void>;
  onTypingStart?: (typing: Typing) => Promise<void> | void;
  getChannelSnapshot?: (channelId: string) => DiscordChannelSnapshot | null;
}

function now(): number {
  return Date.now();
}

export class EventDrivenDiscordCursor implements DiscordCursor {
  readonly id: string;
  readonly kind = "discord" as const;

  private status: DiscordSnapshot["status"] = "idle";
  private readonly onMessage: (message: Message) => Promise<void>;
  private readonly onTypingStart?: (typing: Typing) => Promise<void> | void;
  private readonly getChannelSnapshot?: (
    channelId: string
  ) => DiscordChannelSnapshot | null;
  private readonly context: DiscordCursorContext = {
    queuedActivations: [],
    lastActivatedAt: null,
    lastProcessedAt: null,
    lastActivationType: null,
    lastChannelId: null,
    processing: false,
    recentReports: [],
    channelStates: new Map<string, DiscordChannelSnapshot>(),
  };

  constructor(options: DiscordCursorOptions) {
    this.id = options.id ?? "discord-main";
    this.onMessage = options.onMessage;
    this.onTypingStart = options.onTypingStart;
    this.getChannelSnapshot = options.getChannelSnapshot;
  }

  async activate(input: CursorActivation): Promise<void> {
    const activation = input as DiscordActivation;
    this.context.queuedActivations.push(activation);
    this.context.lastActivatedAt = input.timestamp;
    this.context.lastActivationType = input.type;
    this.context.lastChannelId = this.extractChannelId(activation);
  }

  async tick(): Promise<CursorReport[]> {
    if (this.context.processing) return [];
    if (!this.context.queuedActivations.length) {
      this.status = "idle";
      return [];
    }

    this.context.processing = true;
    this.status = "active";
    const reports: CursorReport[] = [];
    let hadError = false;

    try {
      while (this.context.queuedActivations.length) {
        const activation = this.context.queuedActivations.shift()!;
        const report = await this.processActivation(activation);
        if (report.type === "error") {
          hadError = true;
        }
        reports.push(report);
        this.pushReport(report);
      }
    } finally {
      this.context.processing = false;
      this.context.lastProcessedAt = now();
      this.status = hadError ? "error" : "idle";
    }

    return reports;
  }

  async snapshot(): Promise<DiscordSnapshot> {
    return {
      cursorId: this.id,
      kind: "discord",
      status: this.status,
      queueLength: this.context.queuedActivations.length,
      queuedActivationTypes: this.context.queuedActivations.map(
        (activation) => activation.type
      ),
      lastActivatedAt: this.context.lastActivatedAt,
      lastProcessedAt: this.context.lastProcessedAt,
      lastActivationType: this.context.lastActivationType,
      lastChannelId: this.context.lastChannelId,
      knownChannelCount: this.context.channelStates.size,
      channels: [...this.context.channelStates.values()],
    };
  }

  private async processActivation(
    activation: DiscordActivation
  ): Promise<CursorReport> {
    try {
      switch (activation.type) {
        case "attention_inspect":
          return {
            cursorId: this.id,
            type: "attention_inspected",
            summary: "Stelle inspected the Discord social window.",
            payload: {
              knownChannelCount: this.context.channelStates.size,
              lastChannelId: this.context.lastChannelId,
            },
            timestamp: now(),
          };
        case "message_create":
          {
            const message = activation.payload!.message as Message;
            await this.onMessage(message);
            this.refreshChannelState(message.channel.id);
            const content = message.cleanContent || message.content || "";
            return {
              cursorId: this.id,
              type: "message_processed",
              summary: `Processed Discord message ${message.id}`,
              payload: {
                channelId: message.channel.id,
                guildId: message.guildId,
                messageId: message.id,
                authorId: message.author.id,
                authorName: message.author.username,
                content: content.slice(0, 500),
                contentLength: content.length,
                isDm: !message.guildId,
                createdTimestamp: message.createdTimestamp,
              },
              timestamp: now(),
            };
          }
        case "typing_start":
          if (this.onTypingStart) {
            await this.onTypingStart(activation.payload!.typing as Typing);
          }
          this.refreshChannelState((activation.payload!.typing as Typing).channel.id);
          return {
            cursorId: this.id,
            type: "typing_observed",
            summary: `Observed typing in channel ${(activation.payload!.typing as Typing).channel.id}`,
            payload: {
              channelId: (activation.payload!.typing as Typing).channel.id,
              userId: (activation.payload!.typing as Typing).user?.id ?? null,
            },
            timestamp: now(),
          };
        default:
          return {
            cursorId: this.id,
            type: "activation_ignored",
            summary: `Ignored activation ${activation.type}`,
            timestamp: now(),
          };
      }
    } catch (error) {
      this.status = "error";
      return {
        cursorId: this.id,
        type: "error",
        summary: `Discord cursor error on ${activation.type}: ${(error as Error).message}`,
        timestamp: now(),
      };
    }
  }

  private pushReport(report: CursorReport): void {
    this.context.recentReports.push(report);
    if (this.context.recentReports.length > 50) {
      this.context.recentReports.shift();
    }
  }

  private extractChannelId(activation: DiscordActivation): string | null {
    if (activation.type === "message_create") {
      return (activation.payload?.message as Message | undefined)?.channel.id ?? null;
    }
    if (activation.type === "typing_start") {
      return (activation.payload?.typing as Typing | undefined)?.channel.id ?? null;
    }
    return null;
  }

  private refreshChannelState(channelId: string): void {
    if (!this.getChannelSnapshot) return;
    const snapshot = this.getChannelSnapshot(channelId);
    if (!snapshot) return;
    this.context.channelStates.set(channelId, snapshot);
  }
}
