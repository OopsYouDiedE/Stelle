import type {
  ContextStreamItem,
  CursorConfig,
  CursorPolicy,
  CursorReport,
  CursorToolNamespace,
} from "../../types.js";
import { AsyncConfigStore } from "../../config/AsyncConfigStore.js";
import { BaseCursor } from "../BaseCursor.js";
import type { DiscordChannelSnapshot, DiscordMessageSummary, DiscordRuntime } from "../../discord/types.js";
import { DiscordJsRuntime } from "../../discord/DiscordRuntime.js";
import { DiscordChannelSessionStore, type DiscordChannelSession } from "../../discord/DiscordChannelSession.js";

function now(): number {
  return Date.now();
}

const discordPolicy: CursorPolicy = {
  allowPassiveResponse: true,
  allowBackgroundTick: true,
  allowInitiativeWhenAttached: false,
  passiveResponseRisk: "low",
  escalationRules: [
    {
      id: "discord.external_send",
      summary: "Sending messages is externally visible and must use a higher-authority tool.",
      severity: "warning",
    },
  ],
};

export class DiscordCursor extends BaseCursor {
  private readonly sessions: DiscordChannelSessionStore;
  private readonly queuedMessages: DiscordMessageSummary[] = [];
  private processing = false;

  constructor(
    readonly discord: DiscordRuntime = new DiscordJsRuntime(),
    options?: { id?: string; configStore?: AsyncConfigStore<CursorConfig>; defaultChannelId?: string }
  ) {
    const id = options?.id ?? "discord";
    super(
      { id, kind: "discord", displayName: "Discord Cursor", version: "0.1.0" },
      discordPolicy,
      {
        cursorId: id,
        version: "0.1.0",
        behavior: {
          defaultChannelId: options?.defaultChannelId ?? null,
          passiveHistoryLimit: 20,
        },
        runtime: {
          gateway: "discord.js",
        },
        permissions: {
          externalSend: false,
        },
        updatedAt: now(),
      },
      options?.configStore
    );
    this.sessions = new DiscordChannelSessionStore();
    this.stream.push(this.event("Discord Cursor initialized."));
  }

  getToolNamespace(): CursorToolNamespace {
    return {
      cursorId: this.identity.id,
      namespaces: ["discord"],
      tools: [
        {
          namespace: "discord",
          name: "cursor_status",
          authorityClass: "cursor",
          summary: "Read Discord runtime connection state.",
          authorityHint: "read-only cursor tool",
        },
        {
          namespace: "discord",
          name: "cursor_list_channels",
          authorityClass: "cursor",
          summary: "List accessible Discord channels.",
          authorityHint: "read-only cursor tool",
        },
        {
          namespace: "discord",
          name: "cursor_get_channel_history",
          authorityClass: "cursor",
          summary: "Read recent Discord channel history.",
          authorityHint: "read-only cursor tool",
        },
        {
          namespace: "discord",
          name: "cursor_get_message",
          authorityClass: "cursor",
          summary: "Read a single Discord message.",
          authorityHint: "read-only cursor tool",
        },
        {
          namespace: "discord",
          name: "cursor_reply_mention",
          authorityClass: "cursor",
          summary: "Reply to a Discord message that explicitly mentioned this bot.",
          authorityHint: "low-risk passive @reply only",
        },
        {
          namespace: "discord",
          name: "cursor_reply_direct",
          authorityClass: "cursor",
          summary: "Reply to a direct message received by this bot.",
          authorityHint: "low-risk passive DM reply only",
        },
        {
          namespace: "discord",
          name: "cursor_get_message_reference",
          authorityClass: "cursor",
          summary: "Read a Discord message and its referenced message.",
          authorityHint: "read-only cursor tool",
        },
        {
          namespace: "search",
          name: "cursor_web_search",
          authorityClass: "cursor",
          summary: "Search public web results for passive Discord fact checks.",
          authorityHint: "read-only public web verification",
        },
        {
          namespace: "search",
          name: "cursor_web_read",
          authorityClass: "cursor",
          summary: "Read a public web page for passive Discord fact checks.",
          authorityHint: "read-only public web verification",
        },
      ],
    };
  }

  async receiveMessage(message: DiscordMessageSummary): Promise<CursorReport> {
    this.queuedMessages.push(message);
    this.state = {
      ...this.state,
      status: "active",
      summary: `Discord message queued from ${message.author.username}.`,
      lastInputAt: now(),
    };
    return this.report("discord_message_queued", "info", `Queued Discord message ${message.id}`, false, {
      channelId: message.channelId,
      messageId: message.id,
      authorId: message.author.id,
    });
  }

  async tick(): Promise<CursorReport[]> {
    if (this.processing) return [];
    const reports: CursorReport[] = [];
    const status = await this.discord.getStatus().catch((error: unknown) => ({
      connected: false,
      lastError: String(error),
    }));

    if (!status.connected) {
      this.state = {
        ...this.state,
        status: "degraded",
        summary: "Discord runtime is not connected.",
        lastReportAt: now(),
      };
      reports.push(this.report("discord_health", "warning", "Discord runtime is not connected.", true, { status }));
      return reports;
    }

    this.processing = true;
    try {
      while (this.queuedMessages.length) {
        const message = this.queuedMessages.shift()!;
        const session = this.sessions.get(message.channelId);
        const accepted = session.parseMessage(message);
        if (!accepted) {
          reports.push(
            this.report("discord_message_rejected", "warning", `Rejected oversized Discord message ${message.id}`, true, {
              channelId: message.channelId,
              messageId: message.id,
            })
          );
          continue;
        }
        this.stream.push(this.messageToStreamItem(message));
        this.stream.push(session.toContextStreamItem(this.identity.id));
        reports.push(
          this.report("discord_message_observed", "info", `Observed Discord message ${message.id}`, false, {
            channelId: message.channelId,
            messageId: message.id,
          })
        );
      }
    } finally {
      this.processing = false;
    }

    if (!reports.length) {
      reports.push(this.report("discord_health", "debug", "Discord runtime connected.", false, { status }));
    }
    this.state = {
      ...this.state,
      status: this.state.attached ? "active" : "idle",
      summary: "Discord runtime connected.",
      lastReportAt: now(),
    };
    return reports;
  }

  override async observe() {
    const base = await super.observe();
    const sessionItems = this.sessions.list().map((session) => session.toContextStreamItem(this.identity.id));
    return {
      ...base,
      stream: [...base.stream, ...sessionItems].slice(-20),
      stateSummary: `${base.stateSummary} Active Discord sessions: ${sessionItems.length}.`,
    };
  }

  async passiveRespond(input: ContextStreamItem): Promise<CursorReport[]> {
    if (input.metadata?.discordMessage && typeof input.content === "string") {
      const message: DiscordMessageSummary = {
        id: String(input.metadata.messageId ?? input.id),
        channelId: String(input.metadata.channelId),
        guildId: input.metadata.guildId ? String(input.metadata.guildId) : null,
        author: {
          id: String(input.metadata.authorId ?? "unknown"),
          username: String(input.metadata.authorName ?? "unknown"),
        },
        content: input.content,
        createdTimestamp: input.timestamp,
        mentionedUserIds: Array.isArray(input.metadata.mentionedUserIds)
          ? input.metadata.mentionedUserIds.map(String)
          : undefined,
      };
      return [await this.receiveMessage(message)];
    }
    return [this.report("discord_input_ignored", "debug", "Discord Cursor ignored unsupported passive input.", false)];
  }

  getChannelSnapshot(channelId: string): DiscordChannelSnapshot | undefined {
    return this.sessions.getExisting(channelId)?.snapshot();
  }

  listChannelSnapshots(): DiscordChannelSnapshot[] {
    return this.sessions.snapshots();
  }

  getChannelSession(channelId: string): DiscordChannelSession | undefined {
    return this.sessions.getExisting(channelId);
  }

  getChannelContextText(channelId: string, maxLines = 24): string {
    const session = this.sessions.getExisting(channelId);
    if (!session) return `Discord channel ${channelId} has no local session context yet.`;
    const snapshot = session.snapshot();
    return [
      `Discord channel ${channelId}`,
      snapshot.focus ? `Focus: ${snapshot.focus}` : undefined,
      snapshot.intentSummary ? `Intent: ${snapshot.intentSummary}` : undefined,
      `Messages seen: ${snapshot.msgCount}; active users: ${snapshot.activeUserCount}`,
      ...snapshot.recentHistory.slice(-maxLines),
    ].filter(Boolean).join("\n");
  }

  canReplyToMention(message: DiscordMessageSummary, botUserId?: string | null): boolean {
    if (!botUserId) return false;
    return Boolean(message.mentionedUserIds?.includes(botUserId));
  }

  private messageToStreamItem(message: DiscordMessageSummary): ContextStreamItem {
    return {
      id: `discord-message-${message.id}`,
      type: "text",
      source: this.identity.id,
      timestamp: message.createdTimestamp,
      content: message.content,
      trust: "external",
      metadata: {
        channelId: message.channelId,
        guildId: message.guildId,
        authorId: message.author.id,
        authorName: message.author.username,
        messageId: message.id,
      },
    };
  }

  private event(content: string): ContextStreamItem {
    return {
      id: `discord-event-${now()}`,
      type: "event",
      source: this.identity.id,
      timestamp: now(),
      content,
      trust: "cursor",
    };
  }
}
