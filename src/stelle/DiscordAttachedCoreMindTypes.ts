import type { Client } from "discord.js";
import type { GeminiTextProvider } from "../gemini/GeminiTextProvider.js";
import type { ToolResult } from "../types.js";

export interface DiscordAttachedCoreMindOptions {
  token?: string;
  cursorId?: string;
  defaultChannelId?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  maxReplyChars?: number;
  synthesizeReplies?: boolean;
  client?: Client;
  textProvider?: GeminiTextProvider;
}

export interface DiscordCoreMindMessageResult {
  observed: boolean;
  replied: boolean;
  reply?: ToolResult;
  reason: string;
  route?: "cursor" | "stelle" | "none";
}

export interface DebugToolInvocationOptions {
  cursorId?: string;
  returnToInner?: boolean;
}

export interface DiscordHistoryDebugEntry {
  channelId: string;
  summary: string;
  recentHistory: string[];
  fullHistory: string[];
}
