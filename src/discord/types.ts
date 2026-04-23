export interface DiscordUserSummary {
  id: string;
  username: string;
  tag?: string;
  bot?: boolean;
}

export interface DiscordMessageSummary {
  id: string;
  channelId: string;
  guildId?: string | null;
  author: DiscordUserSummary;
  content: string;
  cleanContent?: string;
  createdTimestamp: number;
  mentionedUserIds?: string[];
  reference?: {
    guildId?: string | null;
    channelId?: string | null;
    messageId?: string | null;
  } | null;
  attachments?: {
    id: string;
    name?: string | null;
    url: string;
    contentType?: string | null;
  }[];
  embeds?: {
    title?: string | null;
    description?: string | null;
    url?: string | null;
  }[];
}

export interface DiscordChannelSummary {
  id: string;
  guildId?: string | null;
  name?: string | null;
  type: string;
  parentId?: string | null;
  topic?: string | null;
  isTextBased: boolean;
  isSendable: boolean;
}

export interface DiscordRuntimeStatus {
  connected: boolean;
  botUserId?: string | null;
  guildCount?: number;
  lastError?: string;
}

export interface DiscordWaitCondition {
  type: string;
  summary?: string;
  expiresAt?: number | null;
  payload?: Record<string, unknown>;
}

export interface DiscordChannelSnapshot {
  channelId: string;
  guildId?: string | null;
  dmUserId?: string | null;
  historySize: number;
  activeUserCount: number;
  focus?: string | null;
  intentSummary?: string | null;
  waitConditionType?: string | null;
  waitExpiresAt?: number | null;
  msgCount: number;
  lastMsgTime?: number | null;
  lastMessageId?: string | null;
  lastMessageAt?: number | null;
  lastAuthorId?: string | null;
  isProcessing: boolean;
  shutUpUntil?: number | null;
  msgCountSinceReview: number;
  reviewCountSinceDistill: number;
  summary: string;
  recentHistory: string[];
}

export interface DiscordRuntime {
  getStatus(): Promise<DiscordRuntimeStatus>;
  listChannels(options?: { guildId?: string; includeThreads?: boolean }): Promise<DiscordChannelSummary[]>;
  getChannelHistory(options: {
    channelId: string;
    limit?: number;
    after?: number;
    before?: number;
  }): Promise<DiscordMessageSummary[]>;
  getMessage(channelId: string, messageId: string): Promise<DiscordMessageSummary>;
  getMessageReference(channelId: string, messageId: string): Promise<{
    sourceMessage: DiscordMessageSummary;
    referencedMessage: DiscordMessageSummary | null;
  }>;
  sendMessage(options: {
    channelId: string;
    content: string;
    mentionUserIds?: string[];
    replyToMessageId?: string;
  }): Promise<DiscordMessageSummary>;
  setBotPresence?(options: { window: string; detail?: string }): Promise<void>;
}
