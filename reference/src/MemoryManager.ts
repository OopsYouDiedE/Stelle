import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { InnerCursor } from "./cursors/BaseCursor.js";
import type { DiscordMessageSummary } from "./DiscordRuntime.js";
import type { Live2DStageState, ObsStatus } from "./live/LiveRuntime.js";

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

  createDiscordSegmentEvent(input: {
    channelId: string;
    guildId?: string | null;
    dmUserId?: string | null;
    focus?: string | null;
    summary: string;
    reason: string;
    startedAt: number;
    endedAt: number;
    messageCount: number;
    replyCount: number;
    participantIds: string[];
    history: string[];
  }): DiscordSegmentMemoryEvent {
    return {
      id: `discord-segment-${input.channelId}-${input.endedAt}`,
      kind: "discord_segment",
      timestamp: input.endedAt,
      tags: ["discord", "segment"],
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
    } else if (event.kind === "discord_segment") {
      await this.processDiscordSegment(event, decision.tags, decision);
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

  private async processDiscordSegment(
    event: DiscordSegmentMemoryEvent,
    tags: string[],
    decision: ReturnType<typeof triageMemoryEvent>
  ): Promise<void> {
    await this.upsertChannelFromSegment(event);
    if (decision.updateGuilds && event.guildId) await this.upsertGuildFromSegment(event);
    if (!decision.writeExperience) return;

    const experience = this.discordSegmentExperienceRecord(event, tags);
    await this.writeRecord(experience);
    if (decision.writeDailySummary) {
      await this.upsertDailySummary(event.timestamp, "discord", experience.id, experience.title ?? experience.id, tags);
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
      is_bot_owner: Boolean(message.author.isBotOwner),
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

  private async upsertChannelFromSegment(event: DiscordSegmentMemoryEvent): Promise<void> {
    const existing = await this.store.read("channels", event.channelId);
    const metadata = asRecord(existing?.metadata);
    const nextMetadata = {
      guild_id: event.guildId ?? null,
      first_seen_at: asString(metadata.first_seen_at) ?? iso(event.startedAt),
      last_seen_at: iso(event.endedAt),
      last_message_id: asString(metadata.last_message_id),
      last_message_preview: event.summary,
      message_count: asNumber(metadata.message_count),
      participant_ids: appendRecent(asStringArray(metadata.participant_ids), event.participantIds, 24),
      reply_count: asNumber(metadata.reply_count),
      segment_count: asNumber(metadata.segment_count) + 1,
      recent_topics: appendRecent(
        asStringArray(metadata.recent_topics),
        uniqueStrings([event.focus ?? undefined, ...topicSnippets(event.summary)], 8),
        12
      ),
      last_segment_summary: shortText(event.summary, 160),
      last_segment_reason: event.reason,
      last_segment_closed_at: iso(event.endedAt),
    };
    await this.writeRecord({
      id: event.channelId,
      collection: "channels",
      type: "discord_channel",
      source: "discord",
      createdAt: existing?.createdAt ?? iso(event.startedAt),
      updatedAt: iso(event.endedAt),
      title: existing?.title ?? `Discord channel ${event.channelId}`,
      tags: uniqueStrings(["discord", "channel", "segment", ...(event.guildId ? ["guild"] : ["dm"])]),
      metadata: nextMetadata,
      content: renderChannelContent(event.channelId, nextMetadata),
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

  private async upsertGuildFromSegment(event: DiscordSegmentMemoryEvent): Promise<void> {
    if (!event.guildId) return;
    const existing = await this.store.read("guilds", event.guildId);
    const metadata = asRecord(existing?.metadata);
    const nextMetadata = {
      first_seen_at: asString(metadata.first_seen_at) ?? iso(event.startedAt),
      last_seen_at: iso(event.endedAt),
      message_count: asNumber(metadata.message_count),
      reply_count: asNumber(metadata.reply_count),
      channel_ids: appendRecent(asStringArray(metadata.channel_ids), [event.channelId], 32),
      participant_ids: appendRecent(asStringArray(metadata.participant_ids), event.participantIds, 32),
      segment_count: asNumber(metadata.segment_count) + 1,
      recent_topics: appendRecent(
        asStringArray(metadata.recent_topics),
        uniqueStrings([event.focus ?? undefined, ...topicSnippets(event.summary)], 10),
        16
      ),
      last_segment_summary: shortText(event.summary, 160),
    };
    await this.writeRecord({
      id: event.guildId,
      collection: "guilds",
      type: "discord_guild",
      source: "discord",
      createdAt: existing?.createdAt ?? iso(event.startedAt),
      updatedAt: iso(event.endedAt),
      title: existing?.title ?? `Discord guild ${event.guildId}`,
      tags: ["discord", "guild", "segment"],
      metadata: nextMetadata,
      content: renderGuildContent(event.guildId, nextMetadata),
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
      `Trusted input: ${message.trustedInput ? "yes" : "no"}`,
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
        trusted_input: Boolean(message.trustedInput),
        is_bot_owner: Boolean(message.author.isBotOwner),
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

  private discordSegmentExperienceRecord(event: DiscordSegmentMemoryEvent, tags: string[]): MemoryRecord {
    const lines = [
      `Channel: ${event.channelId}`,
      event.guildId ? `Guild: ${event.guildId}` : `DM user: ${event.dmUserId ?? "unknown"}`,
      event.focus ? `Focus: ${event.focus}` : undefined,
      `Reason: ${event.reason}`,
      `Observed messages: ${event.messageCount}`,
      `Replies sent by Stelle: ${event.replyCount}`,
      `Participants: ${event.participantIds.join(", ") || "none"}`,
      "",
      "Segment summary:",
      event.summary,
      ...(event.history.length ? ["", "Recent history:", ...event.history] : []),
    ].filter(Boolean);
    return {
      id: event.id,
      collection: "experiences",
      type: "discord_segment_experience",
      source: "discord",
      createdAt: iso(event.startedAt),
      updatedAt: iso(event.endedAt),
      title: `Discord segment in ${event.channelId}`,
      tags: uniqueStrings(tags),
      relatedIds: uniqueStrings([event.dmUserId, event.guildId ?? undefined, event.channelId, ...event.participantIds], 16),
      metadata: {
        channel_id: event.channelId,
        guild_id: event.guildId ?? null,
        dm_user_id: event.dmUserId ?? null,
        focus: event.focus ?? null,
        reason: event.reason,
        started_at: iso(event.startedAt),
        ended_at: iso(event.endedAt),
        observed_message_count: event.messageCount,
        reply_count: event.replyCount,
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
    `Closed segments: ${asNumber(metadata.segment_count)}`,
    `Participants: ${asStringArray(metadata.participant_ids).join(", ") || "none"}`,
    `Recent topics: ${asStringArray(metadata.recent_topics).join(", ") || "none"}`,
    `Last message: ${asString(metadata.last_message_preview) ?? "none"}`,
    `Last segment summary: ${asString(metadata.last_segment_summary) ?? "none"}`,
  ].join("\n");
}

function renderGuildContent(guildId: string, metadata: Record<string, unknown>): string {
  return [
    `Guild id: ${guildId}`,
    `Last seen: ${asString(metadata.last_seen_at) ?? "unknown"}`,
    `Messages observed: ${asNumber(metadata.message_count)}`,
    `Replies sent by Stelle: ${asNumber(metadata.reply_count)}`,
    `Closed segments: ${asNumber(metadata.segment_count)}`,
    `Channels: ${asStringArray(metadata.channel_ids).join(", ") || "none"}`,
    `Participants: ${asStringArray(metadata.participant_ids).join(", ") || "none"}`,
    `Recent topics: ${asStringArray(metadata.recent_topics).join(", ") || "none"}`,
    `Last segment summary: ${asString(metadata.last_segment_summary) ?? "none"}`,
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

export const MEMORY_COLLECTIONS = [
  "people",
  "relationships",
  "experiences",
  "guilds",
  "channels",
  "summaries",
] as const;

export type MemoryCollection = (typeof MEMORY_COLLECTIONS)[number];

export interface MemoryRecord {
  id: string;
  collection: MemoryCollection;
  type: string;
  source: string;
  updatedAt: string;
  createdAt?: string;
  title?: string;
  tags: string[];
  relatedIds?: string[];
  content: string;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchQuery {
  collection?: MemoryCollection;
  id?: string;
  tag?: string;
  query?: string;
  limit?: number;
}

export interface MemorySearchResult {
  record: MemoryRecord;
  path: string;
  excerpt: string;
  score: number;
}

export interface MemoryCollectionStats {
  collection: MemoryCollection;
  count: number;
}

export interface BaseMemoryEvent {
  id: string;
  timestamp: number;
  tags: string[];
}

export interface DiscordMessageMemoryEvent extends BaseMemoryEvent {
  kind: "discord_message";
  message: DiscordMessageSummary;
  dm: boolean;
  mentionedBot: boolean;
  replyRequired: boolean;
  channelActivated: boolean;
  route?: string;
  intent?: string;
}

export interface DiscordReplyMemoryEvent extends BaseMemoryEvent {
  kind: "discord_reply";
  message: DiscordMessageSummary;
  route: "cursor" | "stelle" | "governance" | "debug";
  targetUserId?: string;
  targetUsername?: string;
  targetMessageId?: string;
}

export interface DiscordSegmentMemoryEvent extends BaseMemoryEvent {
  kind: "discord_segment";
  channelId: string;
  guildId?: string | null;
  dmUserId?: string | null;
  focus?: string | null;
  summary: string;
  reason: string;
  startedAt: number;
  endedAt: number;
  messageCount: number;
  replyCount: number;
  participantIds: string[];
  history: string[];
}

export interface LiveActionMemoryEvent extends BaseMemoryEvent {
  kind: "live_action";
  action: string;
  ok: boolean;
  summary: string;
  text?: string;
  stage?: Live2DStageState;
  obs?: ObsStatus;
  source?: string;
  relatedDiscordMessageId?: string;
  metadata?: Record<string, unknown>;
}

export type MemoryEvent =
  | DiscordMessageMemoryEvent
  | DiscordReplyMemoryEvent
  | DiscordSegmentMemoryEvent
  | LiveActionMemoryEvent;

export interface MemoryTriageDecision {
  importance: "low" | "medium" | "high";
  tags: string[];
  reflection: string;
  updatePeople: boolean;
  updateRelationships: boolean;
  updateChannels: boolean;
  updateGuilds: boolean;
  writeExperience: boolean;
  writeDailySummary: boolean;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function clampLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? 20, 1), 100);
}

function sanitizeSegment(value: string): string {
  const normalized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");
  return normalized.replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^\.+|\.+$/g, "") || "untitled";
}

function isMemoryCollection(value: string): value is MemoryCollection {
  return MEMORY_COLLECTIONS.includes(value as MemoryCollection);
}

function toExcerpt(record: MemoryRecord, query?: string): string {
  const normalizedContent = record.content.replace(/\s+/g, " ").trim();
  if (!normalizedContent) return "";
  if (!query) return normalizedContent.slice(0, 180);

  const haystack = `${record.title ?? ""}\n${record.tags.join(" ")}\n${record.content}`;
  const index = haystack.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return normalizedContent.slice(0, 180);

  const compact = haystack.replace(/\s+/g, " ").trim();
  const start = Math.max(0, index - 60);
  const end = Math.min(compact.length, index + Math.max(query.length, 30) + 80);
  return compact.slice(start, end).trim();
}

function scoreRecord(record: MemoryRecord, filters: MemorySearchQuery): number {
  let score = 0;
  if (filters.id && record.id === filters.id) score += 100;
  if (filters.tag && record.tags.some((tag) => tag.toLowerCase() === filters.tag?.toLowerCase())) score += 30;
  if (filters.query) {
    const query = filters.query.toLowerCase();
    if (record.title?.toLowerCase().includes(query)) score += 20;
    if (record.content.toLowerCase().includes(query)) score += 15;
    if (record.tags.some((tag) => tag.toLowerCase().includes(query))) score += 10;
  }
  return score;
}

function parseMemoryFile(content: string, collection: MemoryCollection): MemoryRecord {
  const match = content.match(FRONTMATTER_RE);
  const frontmatter = match ? YAML.parse(match[1]) : {};
  const body = (match?.[2] ?? content).trim();
  const tags = Array.isArray(frontmatter?.tags)
    ? frontmatter.tags.map((item: unknown) => String(item))
    : [];
  const relatedIds = Array.isArray(frontmatter?.related_ids)
    ? frontmatter.related_ids.map((item: unknown) => String(item))
    : undefined;
  const metadata =
    frontmatter?.metadata && typeof frontmatter.metadata === "object" && !Array.isArray(frontmatter.metadata)
      ? (frontmatter.metadata as Record<string, unknown>)
      : undefined;

  return {
    id: String(frontmatter?.id ?? ""),
    collection,
    type: String(frontmatter?.type ?? collection),
    source: String(frontmatter?.source ?? "unknown"),
    createdAt: frontmatter?.created_at ? String(frontmatter.created_at) : undefined,
    updatedAt: String(frontmatter?.updated_at ?? new Date(0).toISOString()),
    title: frontmatter?.title ? String(frontmatter.title) : undefined,
    tags,
    relatedIds,
    metadata,
    content: body,
  };
}

function formatMemoryFile(record: MemoryRecord): string {
  const frontmatter: Record<string, unknown> = {
    id: record.id,
    type: record.type,
    source: record.source,
    updated_at: record.updatedAt,
  };
  if (record.createdAt) frontmatter.created_at = record.createdAt;
  if (record.title) frontmatter.title = record.title;
  if (record.tags.length) frontmatter.tags = record.tags;
  if (record.relatedIds?.length) frontmatter.related_ids = record.relatedIds;
  if (record.metadata && Object.keys(record.metadata).length) frontmatter.metadata = record.metadata;
  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${record.content.trim()}\n`;
}

export class MarkdownMemoryStore {
  constructor(private readonly rootDir = path.resolve(process.cwd(), "memory")) {}

  async ensureStructure(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await Promise.all(MEMORY_COLLECTIONS.map((collection) => mkdir(path.join(this.rootDir, collection), { recursive: true })));
  }

  async write(record: Omit<MemoryRecord, "updatedAt"> & { updatedAt?: string }): Promise<MemoryRecord & { path: string }> {
    await this.ensureStructure();
    const normalized: MemoryRecord = {
      ...record,
      id: record.id.trim(),
      title: record.title?.trim() || undefined,
      content: record.content.trim(),
      source: record.source.trim(),
      type: record.type.trim(),
      updatedAt: record.updatedAt ?? new Date().toISOString(),
      tags: [...new Set((record.tags ?? []).map((tag) => String(tag).trim()).filter(Boolean))],
      relatedIds: record.relatedIds?.map((item) => String(item).trim()).filter(Boolean) ?? undefined,
    };

    if (!normalized.id) throw new Error("Memory record id must not be empty.");
    if (!normalized.content) throw new Error("Memory record content must not be empty.");

    const filePath = this.resolveRecordPath(normalized.collection, normalized.id);
    await writeFile(filePath, formatMemoryFile(normalized), "utf8");
    return { ...normalized, path: filePath };
  }

  async read(collection: MemoryCollection, id: string): Promise<(MemoryRecord & { path: string }) | null> {
    await this.ensureStructure();
    const filePath = this.resolveRecordPath(collection, id);
    try {
      const content = await readFile(filePath, "utf8");
      return { ...parseMemoryFile(content, collection), path: filePath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async search(filters: MemorySearchQuery = {}): Promise<MemorySearchResult[]> {
    await this.ensureStructure();
    const collections = filters.collection ? [filters.collection] : [...MEMORY_COLLECTIONS];
    const files = await Promise.all(collections.map((collection) => this.listCollectionFiles(collection)));
    const matches: MemorySearchResult[] = [];

    for (const { collection, filePath } of files.flat()) {
      const raw = await readFile(filePath, "utf8");
      const record = parseMemoryFile(raw, collection);
      if (!record.id) continue;
      if (filters.id && record.id !== filters.id) continue;
      if (filters.tag && !record.tags.some((tag) => tag.toLowerCase() === filters.tag?.toLowerCase())) continue;
      if (filters.query) {
        const query = filters.query.toLowerCase();
        const haystack = `${record.title ?? ""}\n${record.tags.join(" ")}\n${record.content}`.toLowerCase();
        if (!haystack.includes(query)) continue;
      }

      matches.push({
        record,
        path: filePath,
        excerpt: toExcerpt(record, filters.query),
        score: scoreRecord(record, filters),
      });
    }

    return matches
      .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt))
      .slice(0, clampLimit(filters.limit));
  }

  async list(collection?: MemoryCollection): Promise<Array<MemoryRecord & { path: string }>> {
    await this.ensureStructure();
    const collections = collection ? [collection] : [...MEMORY_COLLECTIONS];
    const files = await Promise.all(collections.map((item) => this.listCollectionFiles(item)));
    const records: Array<MemoryRecord & { path: string }> = [];
    for (const { collection: currentCollection, filePath } of files.flat()) {
      const raw = await readFile(filePath, "utf8");
      records.push({ ...parseMemoryFile(raw, currentCollection), path: filePath });
    }
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async stats(): Promise<MemoryCollectionStats[]> {
    await this.ensureStructure();
    return Promise.all(
      MEMORY_COLLECTIONS.map(async (collection) => ({
        collection,
        count: (await this.listCollectionFiles(collection)).length,
      }))
    );
  }

  private resolveRecordPath(collection: MemoryCollection, id: string): string {
    const filename = `${sanitizeSegment(id)}.md`;
    return path.join(this.rootDir, collection, filename);
  }

  private async listCollectionFiles(collection: MemoryCollection): Promise<Array<{ collection: MemoryCollection; filePath: string }>> {
    const dir = path.join(this.rootDir, collection);
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => ({ collection, filePath: path.join(dir, entry.name) }));
  }
}

export function parseMemoryCollection(value: unknown): MemoryCollection | null {
  if (typeof value !== "string") return null;
  return isMemoryCollection(value) ? value : null;
}

export type MemoryEventListener = (event: MemoryEvent) => void;

export class MemoryEventBus {
  private readonly listeners = new Set<MemoryEventListener>();
  private readonly history: MemoryEvent[] = [];

  subscribe(listener: MemoryEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: MemoryEvent): void {
    this.history.push(event);
    if (this.history.length > 200) this.history.shift();
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  snapshot(): MemoryEvent[] {
    return [...this.history];
  }
}

function triageSnippet(text: string, maxChars = 64): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function triageMemoryEvent(event: MemoryEvent): MemoryTriageDecision {
  if (event.kind === "discord_message") {
    const hasAttachment = Boolean(event.message.attachments?.length || event.message.embeds?.length);
    const hasSubstance = event.message.content.trim().length >= 24;
    const verySubstantive = event.message.content.trim().length >= 80;
    const directReach = event.dm || event.mentionedBot;
    const writeExperience = hasAttachment || (directReach && event.replyRequired && hasSubstance && verySubstantive);
    return {
      importance: event.replyRequired ? "high" : hasAttachment || hasSubstance ? "medium" : "low",
      tags: [
        "discord",
        "message",
        ...(event.dm ? ["dm"] : ["guild"]),
        ...(event.mentionedBot ? ["mention"] : []),
        ...(writeExperience ? ["memory-worthy"] : []),
      ],
      reflection: `Memory triage saw Discord message ${event.message.id} from ${event.message.author.username}: ${triageSnippet(event.message.content || "(empty)")}`,
      updatePeople: !event.message.author.bot,
      updateRelationships: !event.message.author.bot,
      updateChannels: true,
      updateGuilds: Boolean(event.message.guildId),
      writeExperience,
      writeDailySummary: writeExperience,
    };
  }

  if (event.kind === "discord_reply") {
    return {
      importance: "low",
      tags: ["discord", "reply", event.route],
      reflection: `Memory triage recorded Discord reply ${event.message.id} via ${event.route}.`,
      updatePeople: Boolean(event.targetUserId),
      updateRelationships: Boolean(event.targetUserId),
      updateChannels: true,
      updateGuilds: Boolean(event.message.guildId),
      writeExperience: false,
      writeDailySummary: false,
    };
  }

  if (event.kind === "discord_segment") {
    return {
      importance: event.replyCount > 0 || event.messageCount >= 4 ? "high" : "medium",
      tags: ["discord", "segment", ...(event.guildId ? ["guild"] : ["dm"])],
      reflection: `Memory triage closed Discord segment ${event.channelId}: ${triageSnippet(event.summary)}`,
      updatePeople: false,
      updateRelationships: false,
      updateChannels: true,
      updateGuilds: Boolean(event.guildId),
      writeExperience: true,
      writeDailySummary: true,
    };
  }

  const importantAction =
    /start|stop|load_model|trigger_motion|set_expression|set_background|caption|audio|speech/i.test(event.action);
  const textful = Boolean(event.text?.trim());
  return {
    importance: importantAction || textful ? "medium" : "low",
    tags: ["live", event.action, ...(event.ok ? ["ok"] : ["error"]), ...(textful ? ["text"] : [])],
    reflection: `Memory triage recorded live action ${event.action}: ${triageSnippet(event.summary)}`,
    updatePeople: false,
    updateRelationships: false,
    updateChannels: false,
    updateGuilds: false,
    writeExperience: importantAction || textful,
    writeDailySummary: importantAction || textful,
  };
}
