import path from "node:path";
import type { InnerCursor } from "../cursors/InnerCursor.js";
import type { DiscordMessageSummary } from "../discord/types.js";
import { MarkdownMemoryStore } from "./MarkdownMemoryStore.js";
import { MemoryEventBus } from "./MemoryEventBus.js";
import { triageMemoryEvent } from "./MemoryTriage.js";
import type {
  DiscordMessageMemoryEvent,
  DiscordReplyMemoryEvent,
  LiveActionMemoryEvent,
  MemoryEvent,
} from "./events.js";
import type { MemoryCollection, MemoryRecord } from "./types.js";

function now(): number {
  return Date.now();
}

function iso(timestamp = now()): string {
  return new Date(timestamp).toISOString();
}

function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: Array<string | undefined | null>, limit = 12): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function appendRecent(values: string[], additions: string[], limit = 10): string[] {
  return uniqueStrings([...additions, ...values], limit);
}

function shortText(text: string, maxChars = 160): string {
  const normalized = compact(text);
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function topicSnippets(text: string): string[] {
  const cleaned = compact(
    text
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/<@!?\d+>/g, " ")
      .replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
  );
  if (!cleaned) return [];
  const tokens = cleaned
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 24);
  return uniqueStrings(tokens, 6);
}

interface MemoryManagerStats {
  processed: number;
  failed: number;
  pending: number;
  lastError?: string;
  lastProcessedAt?: string;
  lastEventId?: string;
}

interface RecentWrite {
  collection: MemoryCollection;
  id: string;
  updatedAt: string;
}

interface DailySummaryMetadataRecord extends Record<string, unknown> {
  date: string;
  event_count: number;
  experience_ids: string[];
  lines: string[];
  source_counts: Record<string, number>;
}

export class MemoryManager {
  readonly bus = new MemoryEventBus();
  readonly store: MarkdownMemoryStore;

  private queue: Promise<void> = Promise.resolve();
  private stats: MemoryManagerStats = {
    processed: 0,
    failed: 0,
    pending: 0,
  };
  private readonly recentWrites: RecentWrite[] = [];

  constructor(options?: { rootDir?: string; innerCursor?: InnerCursor }) {
    this.store = new MarkdownMemoryStore(options?.rootDir ?? path.resolve(process.cwd(), "memory"));
    this.innerCursor = options?.innerCursor;
    this.bus.subscribe((event) => this.enqueue(event));
  }

  private readonly innerCursor?: InnerCursor;

  async start(): Promise<void> {
    await this.store.ensureStructure();
  }

  publish(event: MemoryEvent): void {
    this.bus.publish(event);
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  async snapshot(): Promise<Record<string, unknown>> {
    return {
      stats: { ...this.stats },
      collections: await this.store.stats(),
      recentEvents: this.bus.snapshot().slice(-24).reverse(),
      recentWrites: [...this.recentWrites],
    };
  }

  async recallForDiscordMessage(message: DiscordMessageSummary): Promise<string> {
    await this.flush();
    const sections: string[] = [];
    const person = await this.store.read("people", message.author.id);
    const relationship = await this.store.read(
      "relationships",
      message.guildId ? `guild-${message.guildId}__user-${message.author.id}` : `dm__user-${message.author.id}`
    );
    const channel = await this.store.read("channels", message.channelId);
    const guild = message.guildId ? await this.store.read("guilds", message.guildId) : null;
    const query = shortText(message.content, 48);
    const relatedExperiences = query
      ? await this.store.search({ collection: "experiences", query, limit: 3 })
      : [];
    const relatedSummaries = query
      ? await this.store.search({ collection: "summaries", query, limit: 2 })
      : [];

    if (person) sections.push(`Person: ${briefRecord(person)}`);
    if (relationship) sections.push(`Relationship: ${briefRecord(relationship)}`);
    if (channel) sections.push(`Channel: ${briefRecord(channel)}`);
    if (guild) sections.push(`Guild: ${briefRecord(guild)}`);
    if (relatedExperiences.length) {
      sections.push(
        `Related experiences: ${relatedExperiences
          .map((item) => `${item.record.id}=${shortText(item.excerpt || item.record.content, 100)}`)
          .join(" | ")}`
      );
    }
    if (relatedSummaries.length) {
      sections.push(
        `Related summaries: ${relatedSummaries
          .map((item) => `${item.record.id}=${shortText(item.excerpt || item.record.content, 100)}`)
          .join(" | ")}`
      );
    }
    return sections.join("\n");
  }

  async recallForLivePrompt(text: string): Promise<string> {
    await this.flush();
    const query = shortText(text, 48);
    if (!query) return "";
    const experiences = await this.store.search({ collection: "experiences", query, limit: 4 });
    const summaries = await this.store.search({ collection: "summaries", query, limit: 2 });
    const lines = [
      ...experiences.map((item) => `Experience ${item.record.id}: ${shortText(item.excerpt || item.record.content, 120)}`),
      ...summaries.map((item) => `Summary ${item.record.id}: ${shortText(item.excerpt || item.record.content, 120)}`),
    ];
    return lines.join("\n");
  }

  createDiscordMessageEvent(input: {
    message: DiscordMessageSummary;
    dm: boolean;
    mentionedBot: boolean;
    replyRequired: boolean;
    channelActivated: boolean;
    route?: string;
    intent?: string;
  }): DiscordMessageMemoryEvent {
    return {
      id: `discord-message-${input.message.id}`,
      kind: "discord_message",
      timestamp: input.message.createdTimestamp,
      tags: ["discord", "message"],
      ...input,
    };
  }

  createDiscordReplyEvent(input: {
    message: DiscordMessageSummary;
    route: "cursor" | "stelle" | "governance" | "debug";
    targetUserId?: string;
    targetUsername?: string;
    targetMessageId?: string;
  }): DiscordReplyMemoryEvent {
    return {
      id: `discord-reply-${input.message.id}`,
      kind: "discord_reply",
      timestamp: input.message.createdTimestamp,
      tags: ["discord", "reply", input.route],
      ...input,
    };
  }

  createLiveActionEvent(input: {
    action: string;
    ok: boolean;
    summary: string;
    text?: string;
    stage?: LiveActionMemoryEvent["stage"];
    obs?: LiveActionMemoryEvent["obs"];
    source?: string;
    relatedDiscordMessageId?: string;
    metadata?: Record<string, unknown>;
    timestamp?: number;
  }): LiveActionMemoryEvent {
    return {
      id: `live-action-${input.action}-${input.timestamp ?? now()}-${Math.random().toString(36).slice(2)}`,
      kind: "live_action",
      timestamp: input.timestamp ?? now(),
      tags: ["live", input.action],
      ...input,
    };
  }

  private enqueue(event: MemoryEvent): void {
    this.stats.pending += 1;
    this.queue = this.queue
      .then(() => this.processEvent(event))
      .catch((error) => {
        this.stats.failed += 1;
        this.stats.lastError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        this.stats.pending = Math.max(0, this.stats.pending - 1);
      });
  }

  private async processEvent(event: MemoryEvent): Promise<void> {
    const decision = triageMemoryEvent(event);
    this.innerCursor?.addReflection(decision.reflection);

    if (event.kind === "discord_message") {
      await this.processDiscordMessage(event, decision.tags, decision);
    } else if (event.kind === "discord_reply") {
      await this.processDiscordReply(event, decision.tags, decision);
    } else {
      await this.processLiveAction(event, decision.tags, decision);
    }

    this.stats.processed += 1;
    this.stats.lastProcessedAt = iso();
    this.stats.lastEventId = event.id;
  }

  private async processDiscordMessage(
    event: DiscordMessageMemoryEvent,
    tags: string[],
    decision: ReturnType<typeof triageMemoryEvent>
  ): Promise<void> {
    const { message } = event;
    if (decision.updatePeople) await this.upsertPersonFromMessage(message);
    if (decision.updateChannels) await this.upsertChannelFromMessage(message);
    if (decision.updateGuilds && message.guildId) await this.upsertGuildFromMessage(message);
    if (decision.updateRelationships) await this.upsertRelationshipFromMessage(message);
    if (!decision.writeExperience) return;

    const experience = this.discordMessageExperienceRecord(event, tags);
    await this.writeRecord(experience);
    if (decision.writeDailySummary) {
      await this.upsertDailySummary(event.timestamp, "discord", experience.id, experience.title ?? experience.id, tags);
    }
  }

  private async processDiscordReply(
    event: DiscordReplyMemoryEvent,
    tags: string[],
    decision: ReturnType<typeof triageMemoryEvent>
  ): Promise<void> {
    await this.upsertChannelFromReply(event);
    if (decision.updateGuilds && event.message.guildId) await this.upsertGuildFromReply(event);
    if (decision.updatePeople && event.targetUserId) await this.upsertPersonFromReply(event);
    if (decision.updateRelationships && event.targetUserId) await this.upsertRelationshipFromReply(event);

    if (!decision.writeExperience) return;
    const experience = this.discordReplyExperienceRecord(event, tags);
    await this.writeRecord(experience);
    if (decision.writeDailySummary) {
      await this.upsertDailySummary(event.timestamp, "discord", experience.id, experience.title ?? experience.id, tags);
    }
  }

  private async processLiveAction(
    event: LiveActionMemoryEvent,
    tags: string[],
    decision: ReturnType<typeof triageMemoryEvent>
  ): Promise<void> {
    if (!decision.writeExperience) return;
    const experience = this.liveActionExperienceRecord(event, tags);
    await this.writeRecord(experience);
    if (decision.writeDailySummary) {
      await this.upsertDailySummary(event.timestamp, "live", experience.id, experience.title ?? experience.id, tags);
    }
  }

  private async upsertPersonFromMessage(message: DiscordMessageSummary): Promise<void> {
    const existing = await this.store.read("people", message.author.id);
    const metadata = asRecord(existing?.metadata);
    const nextMetadata = {
      preferred_name: message.author.username,
      aliases: appendRecent(asStringArray(metadata.aliases), [message.author.username], 8),
      first_seen_at: asString(metadata.first_seen_at) ?? iso(message.createdTimestamp),
      last_seen_at: iso(message.createdTimestamp),
      guild_ids: appendRecent(asStringArray(metadata.guild_ids), message.guildId ? [message.guildId] : [], 12),
      channel_ids: appendRecent(asStringArray(metadata.channel_ids), [message.channelId], 16),
      message_count: asNumber(metadata.message_count) + 1,
      direct_mention_count: asNumber(metadata.direct_mention_count) + (message.mentionedUserIds?.length ? 1 : 0),
      dm_message_count: asNumber(metadata.dm_message_count) + (message.guildId ? 0 : 1),
      last_message_preview: shortText(message.content || "(empty message)"),
      last_message_id: message.id,
      recent_topics: appendRecent(asStringArray(metadata.recent_topics), topicSnippets(message.content), 10),
      bot: Boolean(message.author.bot),
    };

    await this.writeRecord({
      id: message.author.id,
      collection: "people",
      type: "person_profile",
      source: "discord",
      createdAt: existing?.createdAt ?? nextMetadata.first_seen_at,
      updatedAt: iso(message.createdTimestamp),
      title: message.author.username,
      tags: uniqueStrings(["discord", "person", ...(message.guildId ? ["guild"] : ["dm"])]),
      metadata: nextMetadata,
      content: renderPersonContent(nextMetadata),
    });
  }

  private async upsertPersonFromReply(event: DiscordReplyMemoryEvent): Promise<void> {
    if (!event.targetUserId) return;
    const existing = await this.store.read("people", event.targetUserId);
    const metadata = asRecord(existing?.metadata);
    const nextMetadata = {
      preferred_name: event.targetUsername ?? asString(metadata.preferred_name) ?? event.targetUserId,
      aliases: appendRecent(asStringArray(metadata.aliases), event.targetUsername ? [event.targetUsername] : [], 8),
      first_seen_at: asString(metadata.first_seen_at) ?? iso(event.timestamp),
      last_seen_at: iso(event.timestamp),
      guild_ids: appendRecent(asStringArray(metadata.guild_ids), event.message.guildId ? [event.message.guildId] : [], 12),
      channel_ids: appendRecent(asStringArray(metadata.channel_ids), [event.message.channelId], 16),
      message_count: asNumber(metadata.message_count),
      direct_mention_count: asNumber(metadata.direct_mention_count),
      dm_message_count: asNumber(metadata.dm_message_count),
      last_message_preview: asString(metadata.last_message_preview),
      last_message_id: asString(metadata.last_message_id),
      recent_topics: appendRecent(asStringArray(metadata.recent_topics), topicSnippets(event.message.content), 10),
      bot: false,
    };

    await this.writeRecord({
      id: event.targetUserId,
      collection: "people",
      type: "person_profile",
      source: "discord",
      createdAt: existing?.createdAt ?? nextMetadata.first_seen_at,
      updatedAt: iso(event.timestamp),
      title: event.targetUsername ?? existing?.title ?? event.targetUserId,
      tags: uniqueStrings(["discord", "person", ...(event.message.guildId ? ["guild"] : ["dm"])]),
      metadata: nextMetadata,
      content: renderPersonContent(nextMetadata),
    });
  }

  private async upsertChannelFromMessage(message: DiscordMessageSummary): Promise<void> {
    const existing = await this.store.read("channels", message.channelId);
    const metadata = asRecord(existing?.metadata);
    const nextMetadata = {
      guild_id: message.guildId ?? null,
      first_seen_at: asString(metadata.first_seen_at) ?? iso(message.createdTimestamp),
      last_seen_at: iso(message.createdTimestamp),
      last_message_id: message.id,
      last_message_preview: shortText(message.content || "(empty message)"),
      message_count: asNumber(metadata.message_count) + 1,
      participant_ids: appendRecent(asStringArray(metadata.participant_ids), [message.author.id], 24),
      recent_topics: appendRecent(asStringArray(metadata.recent_topics), topicSnippets(message.content), 12),
    };
    await this.writeRecord({
      id: message.channelId,
      collection: "channels",
      type: "discord_channel",
      source: "discord",
      createdAt: existing?.createdAt ?? nextMetadata.first_seen_at,
      updatedAt: iso(message.createdTimestamp),
      title: existing?.title ?? `Discord channel ${message.channelId}`,
      tags: uniqueStrings(["discord", "channel", ...(message.guildId ? ["guild"] : ["dm"])]),
      metadata: nextMetadata,
      content: renderChannelContent(message.channelId, nextMetadata),
    });
  }

  private async upsertChannelFromReply(event: DiscordReplyMemoryEvent): Promise<void> {
    const existing = await this.store.read("channels", event.message.channelId);
    const metadata = asRecord(existing?.metadata);
    const nextMetadata = {
      guild_id: event.message.guildId ?? null,
      first_seen_at: asString(metadata.first_seen_at) ?? iso(event.timestamp),
      last_seen_at: iso(event.timestamp),
      last_message_id: event.message.id,
      last_message_preview: shortText(event.message.content || "(empty message)"),
      message_count: asNumber(metadata.message_count),
      participant_ids: appendRecent(asStringArray(metadata.participant_ids), [event.message.author.id], 24),
      reply_count: asNumber(metadata.reply_count) + 1,
      recent_topics: appendRecent(asStringArray(metadata.recent_topics), topicSnippets(event.message.content), 12),
    };
    await this.writeRecord({
      id: event.message.channelId,
      collection: "channels",
      type: "discord_channel",
      source: "discord",
      createdAt: existing?.createdAt ?? nextMetadata.first_seen_at,
      updatedAt: iso(event.timestamp),
      title: existing?.title ?? `Discord channel ${event.message.channelId}`,
      tags: uniqueStrings(["discord", "channel", "reply", ...(event.message.guildId ? ["guild"] : ["dm"])]),
      metadata: nextMetadata,
      content: renderChannelContent(event.message.channelId, nextMetadata),
    });
  }

  private async upsertGuildFromMessage(message: DiscordMessageSummary): Promise<void> {
    if (!message.guildId) return;
    const existing = await this.store.read("guilds", message.guildId);
    const metadata = asRecord(existing?.metadata);
    const nextMetadata = {
      first_seen_at: asString(metadata.first_seen_at) ?? iso(message.createdTimestamp),
      last_seen_at: iso(message.createdTimestamp),
      message_count: asNumber(metadata.message_count) + 1,
      channel_ids: appendRecent(asStringArray(metadata.channel_ids), [message.channelId], 32),
      participant_ids: appendRecent(asStringArray(metadata.participant_ids), [message.author.id], 32),
      recent_topics: appendRecent(asStringArray(metadata.recent_topics), topicSnippets(message.content), 16),
    };
    await this.writeRecord({
      id: message.guildId,
      collection: "guilds",
      type: "discord_guild",
      source: "discord",
      createdAt: existing?.createdAt ?? nextMetadata.first_seen_at,
      updatedAt: iso(message.createdTimestamp),
      title: existing?.title ?? `Discord guild ${message.guildId}`,
      tags: ["discord", "guild"],
      metadata: nextMetadata,
      content: renderGuildContent(message.guildId, nextMetadata),
    });
  }

  private async upsertGuildFromReply(event: DiscordReplyMemoryEvent): Promise<void> {
    if (!event.message.guildId) return;
    const existing = await this.store.read("guilds", event.message.guildId);
    const metadata = asRecord(existing?.metadata);
    const nextMetadata = {
      first_seen_at: asString(metadata.first_seen_at) ?? iso(event.timestamp),
      last_seen_at: iso(event.timestamp),
      message_count: asNumber(metadata.message_count),
      reply_count: asNumber(metadata.reply_count) + 1,
      channel_ids: appendRecent(asStringArray(metadata.channel_ids), [event.message.channelId], 32),
      participant_ids: appendRecent(asStringArray(metadata.participant_ids), [event.message.author.id], 32),
      recent_topics: appendRecent(asStringArray(metadata.recent_topics), topicSnippets(event.message.content), 16),
    };
    await this.writeRecord({
      id: event.message.guildId,
      collection: "guilds",
      type: "discord_guild",
      source: "discord",
      createdAt: existing?.createdAt ?? nextMetadata.first_seen_at,
      updatedAt: iso(event.timestamp),
      title: existing?.title ?? `Discord guild ${event.message.guildId}`,
      tags: ["discord", "guild", "reply"],
      metadata: nextMetadata,
      content: renderGuildContent(event.message.guildId, nextMetadata),
    });
  }

  private async upsertRelationshipFromMessage(message: DiscordMessageSummary): Promise<void> {
    const id = message.guildId ? `guild-${message.guildId}__user-${message.author.id}` : `dm__user-${message.author.id}`;
    const existing = await this.store.read("relationships", id);
    const metadata = asRecord(existing?.metadata);
    const nextMetadata = {
      user_id: message.author.id,
      username: message.author.username,
      guild_id: message.guildId ?? null,
      first_seen_at: asString(metadata.first_seen_at) ?? iso(message.createdTimestamp),
      last_seen_at: iso(message.createdTimestamp),
      observed_messages: asNumber(metadata.observed_messages) + 1,
      replies_sent_by_stelle: asNumber(metadata.replies_sent_by_stelle),
      direct_mentions_to_stelle: asNumber(metadata.direct_mentions_to_stelle) + (message.mentionedUserIds?.length ? 1 : 0),
      channel_ids: appendRecent(asStringArray(metadata.channel_ids), [message.channelId], 16),
      recent_topics: appendRecent(asStringArray(metadata.recent_topics), topicSnippets(message.content), 12),
      last_interaction_summary: shortText(message.content || "(empty message)"),
    };
    await this.writeRecord({
      id,
      collection: "relationships",
      type: "discord_relationship",
      source: "discord",
      createdAt: existing?.createdAt ?? nextMetadata.first_seen_at,
      updatedAt: iso(message.createdTimestamp),
      title: message.guildId
        ? `${message.author.username} in guild ${message.guildId}`
        : `DM relationship with ${message.author.username}`,
      tags: uniqueStrings(["discord", "relationship", ...(message.guildId ? ["guild"] : ["dm"])]),
      relatedIds: uniqueStrings([message.author.id, message.guildId ?? undefined, message.channelId], 8),
      metadata: nextMetadata,
      content: renderRelationshipContent(nextMetadata),
    });
  }

  private async upsertRelationshipFromReply(event: DiscordReplyMemoryEvent): Promise<void> {
    if (!event.targetUserId) return;
    const id = event.message.guildId
      ? `guild-${event.message.guildId}__user-${event.targetUserId}`
      : `dm__user-${event.targetUserId}`;
    const existing = await this.store.read("relationships", id);
    const metadata = asRecord(existing?.metadata);
    const nextMetadata = {
      user_id: event.targetUserId,
      username: event.targetUsername ?? asString(metadata.username) ?? event.targetUserId,
      guild_id: event.message.guildId ?? null,
      first_seen_at: asString(metadata.first_seen_at) ?? iso(event.timestamp),
      last_seen_at: iso(event.timestamp),
      observed_messages: asNumber(metadata.observed_messages),
      replies_sent_by_stelle: asNumber(metadata.replies_sent_by_stelle) + 1,
      direct_mentions_to_stelle: asNumber(metadata.direct_mentions_to_stelle),
      channel_ids: appendRecent(asStringArray(metadata.channel_ids), [event.message.channelId], 16),
      recent_topics: appendRecent(asStringArray(metadata.recent_topics), topicSnippets(event.message.content), 12),
      last_interaction_summary: `Stelle replied via ${event.route}: ${shortText(event.message.content || "(empty message)")}`,
    };
    await this.writeRecord({
      id,
      collection: "relationships",
      type: "discord_relationship",
      source: "discord",
      createdAt: existing?.createdAt ?? nextMetadata.first_seen_at,
      updatedAt: iso(event.timestamp),
      title: event.message.guildId
        ? `${nextMetadata.username} in guild ${event.message.guildId}`
        : `DM relationship with ${nextMetadata.username}`,
      tags: uniqueStrings(["discord", "relationship", "reply", ...(event.message.guildId ? ["guild"] : ["dm"])]),
      relatedIds: uniqueStrings([event.targetUserId, event.message.guildId ?? undefined, event.message.channelId], 8),
      metadata: nextMetadata,
      content: renderRelationshipContent(nextMetadata),
    });
  }

  private discordMessageExperienceRecord(event: DiscordMessageMemoryEvent, tags: string[]): MemoryRecord {
    const { message } = event;
    const lines = [
      `Author: ${message.author.username} (${message.author.id})`,
      `Channel: ${message.channelId}`,
      message.guildId ? `Guild: ${message.guildId}` : "Guild: DM",
      `Reply required: ${event.replyRequired ? "yes" : "no"}`,
      event.route ? `Route: ${event.route}` : undefined,
      event.intent ? `Intent: ${event.intent}` : undefined,
      "",
      "Message:",
      message.content || "(empty message)",
      ...(message.attachments?.length
        ? ["", "Attachments:", ...message.attachments.map((item) => `- ${item.name ?? item.id}: ${item.url}`)]
        : []),
      ...(message.embeds?.length
        ? ["", "Embeds:", ...message.embeds.map((item) => `- ${item.title ?? "embed"} ${item.url ?? ""}`.trim())]
        : []),
    ].filter(Boolean);
    return {
      id: event.id,
      collection: "experiences",
      type: "discord_message_experience",
      source: "discord",
      createdAt: iso(event.timestamp),
      updatedAt: iso(event.timestamp),
      title: `Discord message from ${message.author.username}`,
      tags: uniqueStrings(tags),
      relatedIds: uniqueStrings([message.author.id, message.guildId ?? undefined, message.channelId, message.id], 12),
      metadata: {
        author_id: message.author.id,
        author_name: message.author.username,
        message_id: message.id,
        channel_id: message.channelId,
        guild_id: message.guildId ?? null,
        route: event.route,
        intent: event.intent,
        dm: event.dm,
        mentioned_bot: event.mentionedBot,
      },
      content: lines.join("\n"),
    };
  }

  private discordReplyExperienceRecord(event: DiscordReplyMemoryEvent, tags: string[]): MemoryRecord {
    const lines = [
      `Route: ${event.route}`,
      `Channel: ${event.message.channelId}`,
      event.message.guildId ? `Guild: ${event.message.guildId}` : "Guild: DM",
      event.targetUserId ? `Target user: ${event.targetUsername ?? event.targetUserId} (${event.targetUserId})` : undefined,
      event.targetMessageId ? `Target message: ${event.targetMessageId}` : undefined,
      "",
      "Reply:",
      event.message.content || "(empty reply)",
    ].filter(Boolean);
    return {
      id: event.id,
      collection: "experiences",
      type: "discord_reply_experience",
      source: "discord",
      createdAt: iso(event.timestamp),
      updatedAt: iso(event.timestamp),
      title: `Discord reply via ${event.route}`,
      tags: uniqueStrings(tags),
      relatedIds: uniqueStrings([event.targetUserId, event.message.guildId ?? undefined, event.message.channelId, event.message.id], 12),
      metadata: {
        route: event.route,
        message_id: event.message.id,
        channel_id: event.message.channelId,
        guild_id: event.message.guildId ?? null,
        target_user_id: event.targetUserId ?? null,
        target_message_id: event.targetMessageId ?? null,
      },
      content: lines.join("\n"),
    };
  }

  private liveActionExperienceRecord(event: LiveActionMemoryEvent, tags: string[]): MemoryRecord {
    const lines = [
      `Action: ${event.action}`,
      `Status: ${event.ok ? "ok" : "error"}`,
      `Summary: ${event.summary}`,
      event.source ? `Source: ${event.source}` : undefined,
      event.relatedDiscordMessageId ? `Related Discord message: ${event.relatedDiscordMessageId}` : undefined,
      event.text ? "" : undefined,
      event.text ? "Text:" : undefined,
      event.text ? event.text : undefined,
      event.stage?.model?.id ? "" : undefined,
      event.stage?.model?.id ? `Live2D model: ${event.stage.model.id}` : undefined,
      event.stage?.caption ? `Caption: ${event.stage.caption}` : undefined,
      typeof event.obs?.streaming === "boolean" ? `OBS streaming: ${event.obs.streaming}` : undefined,
    ].filter(Boolean);
    return {
      id: event.id,
      collection: "experiences",
      type: "live_action_experience",
      source: "live",
      createdAt: iso(event.timestamp),
      updatedAt: iso(event.timestamp),
      title: `Live action ${event.action}`,
      tags: uniqueStrings(tags),
      relatedIds: uniqueStrings([event.relatedDiscordMessageId], 8),
      metadata: {
        action: event.action,
        ok: event.ok,
        source: event.source ?? null,
        related_discord_message_id: event.relatedDiscordMessageId ?? null,
      },
      content: lines.join("\n"),
    };
  }

  private async upsertDailySummary(
    timestamp: number,
    source: "discord" | "live",
    experienceId: string,
    line: string,
    tags: string[]
  ): Promise<void> {
    const id = `daily-${dayKey(timestamp)}`;
    const existing = await this.store.read("summaries", id);
    const metadata = asDailySummaryMetadata(existing?.metadata);
    const nextMetadata: DailySummaryMetadataRecord = {
      date: dayKey(timestamp),
      event_count: metadata.event_count + 1,
      experience_ids: appendRecent(metadata.experience_ids, [experienceId], 64),
      lines: appendRecent(metadata.lines, [shortText(line, 140)], 40),
      source_counts: {
        ...metadata.source_counts,
        [source]: asNumber(metadata.source_counts[source]) + 1,
      },
    };
    await this.writeRecord({
      id,
      collection: "summaries",
      type: "daily_summary",
      source: "memory_pipeline",
      createdAt: existing?.createdAt ?? iso(timestamp),
      updatedAt: iso(timestamp),
      title: `Daily summary ${nextMetadata.date}`,
      tags: uniqueStrings(["summary", "daily", source, ...tags], 16),
      relatedIds: nextMetadata.experience_ids.slice(0, 20),
      metadata: nextMetadata,
      content: renderDailySummaryContent(nextMetadata),
    });
  }

  private async writeRecord(record: MemoryRecord): Promise<void> {
    const written = await this.store.write(record);
    this.recentWrites.unshift({
      collection: written.collection,
      id: written.id,
      updatedAt: written.updatedAt,
    });
    if (this.recentWrites.length > 40) this.recentWrites.pop();
  }
}

function briefRecord(record: MemoryRecord): string {
  return shortText(record.title ? `${record.title}. ${record.content}` : record.content, 140);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asDailySummaryMetadata(value: unknown): DailySummaryMetadataRecord {
  const metadata = asRecord(value);
  return {
    date: asString(metadata.date) ?? "",
    event_count: asNumber(metadata.event_count),
    experience_ids: asStringArray(metadata.experience_ids),
    lines: asStringArray(metadata.lines),
    source_counts: Object.fromEntries(
      Object.entries(asRecord(metadata.source_counts)).map(([key, raw]) => [key, asNumber(raw)])
    ),
  };
}

function renderPersonContent(metadata: Record<string, unknown>): string {
  return [
    `Preferred name: ${asString(metadata.preferred_name) ?? "unknown"}`,
    `Last seen: ${asString(metadata.last_seen_at) ?? "unknown"}`,
    `Messages observed: ${asNumber(metadata.message_count)}`,
    `Direct mentions to Stelle: ${asNumber(metadata.direct_mention_count)}`,
    `DM messages: ${asNumber(metadata.dm_message_count)}`,
    `Guilds: ${asStringArray(metadata.guild_ids).join(", ") || "none"}`,
    `Channels: ${asStringArray(metadata.channel_ids).join(", ") || "none"}`,
    `Recent topics: ${asStringArray(metadata.recent_topics).join(", ") || "none"}`,
    `Last message: ${asString(metadata.last_message_preview) ?? "none"}`,
  ].join("\n");
}

function renderChannelContent(channelId: string, metadata: Record<string, unknown>): string {
  return [
    `Channel id: ${channelId}`,
    `Guild id: ${asString(metadata.guild_id) ?? "dm"}`,
    `Last seen: ${asString(metadata.last_seen_at) ?? "unknown"}`,
    `Messages observed: ${asNumber(metadata.message_count)}`,
    `Replies sent by Stelle: ${asNumber(metadata.reply_count)}`,
    `Participants: ${asStringArray(metadata.participant_ids).join(", ") || "none"}`,
    `Recent topics: ${asStringArray(metadata.recent_topics).join(", ") || "none"}`,
    `Last message: ${asString(metadata.last_message_preview) ?? "none"}`,
  ].join("\n");
}

function renderGuildContent(guildId: string, metadata: Record<string, unknown>): string {
  return [
    `Guild id: ${guildId}`,
    `Last seen: ${asString(metadata.last_seen_at) ?? "unknown"}`,
    `Messages observed: ${asNumber(metadata.message_count)}`,
    `Replies sent by Stelle: ${asNumber(metadata.reply_count)}`,
    `Channels: ${asStringArray(metadata.channel_ids).join(", ") || "none"}`,
    `Participants: ${asStringArray(metadata.participant_ids).join(", ") || "none"}`,
    `Recent topics: ${asStringArray(metadata.recent_topics).join(", ") || "none"}`,
  ].join("\n");
}

function renderRelationshipContent(metadata: Record<string, unknown>): string {
  return [
    `User id: ${asString(metadata.user_id) ?? "unknown"}`,
    `Username: ${asString(metadata.username) ?? "unknown"}`,
    `Guild id: ${asString(metadata.guild_id) ?? "dm"}`,
    `First seen: ${asString(metadata.first_seen_at) ?? "unknown"}`,
    `Last seen: ${asString(metadata.last_seen_at) ?? "unknown"}`,
    `Observed messages: ${asNumber(metadata.observed_messages)}`,
    `Replies sent by Stelle: ${asNumber(metadata.replies_sent_by_stelle)}`,
    `Direct mentions to Stelle: ${asNumber(metadata.direct_mentions_to_stelle)}`,
    `Channels: ${asStringArray(metadata.channel_ids).join(", ") || "none"}`,
    `Recent topics: ${asStringArray(metadata.recent_topics).join(", ") || "none"}`,
    `Last interaction: ${asString(metadata.last_interaction_summary) ?? "none"}`,
  ].join("\n");
}

function renderDailySummaryContent(metadata: DailySummaryMetadataRecord): string {
  return [
    `Date: ${metadata.date}`,
    `Events captured: ${metadata.event_count}`,
    `Source counts: ${Object.entries(metadata.source_counts)
      .map(([key, value]) => `${key}=${value}`)
      .join(", ") || "none"}`,
    "",
    "Highlights:",
    ...metadata.lines.map((line) => `- ${line}`),
  ].join("\n");
}
