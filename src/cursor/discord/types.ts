import type { DiscordMessageSummary } from "../../utils/discord.js";

export type RouterMode = "reply" | "silent" | "deactivate";
export type DiscordIntent = "local_chat" | "live_request" | "memory_query" | "memory_write" | "factual_query" | "system_status";

export interface DiscordToolCall {
  tool: string;
  parameters: Record<string, any>;
}

export interface DiscordToolPlan {
  calls: DiscordToolCall[];
  parallel: boolean;
}

export interface DiscordReplyPolicy {
  mode: RouterMode;
  intent: DiscordIntent;
  reason: string;
  needsThinking: boolean;
  toolPlan?: DiscordToolPlan;
  focus?: string;
}

export interface DiscordToolResultView {
  name: string;
  ok: boolean;
  summary: string;
  data?: Record<string, any>;
}

export interface DiscordChannelSession {
  channelId: string;
  guildId?: string | null;
  history: DiscordMessageSummary[];
  inbox: DiscordMessageSummary[];
  processing: boolean;
  mode: "active" | "silent" | "deactivated";
  modeExpiresAt?: number;
  cooldownUntil?: number;
  debounceTimer?: NodeJS.Timeout | null;
}
