import type { DiscordMessageSummary } from "../../utils/discord.js";
import type { BehaviorPolicy } from "../types.js";

export type RouterMode = "reply" | "silent" | "wait_intent" | "deactivate";
export type DiscordIntent = "local_chat" | "live_request" | "memory_query" | "memory_write" | "factual_query" | "system_status";

export interface DiscordToolCall {
  tool: string;
  parameters: Record<string, unknown>;
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
  waitSeconds?: number;
  clearContext?: boolean;
  behaviorOverride?: BehaviorPolicy; // 结构化指令覆盖
}

export interface DiscordToolResultView {
  name: string;
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; retryable: boolean };
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
