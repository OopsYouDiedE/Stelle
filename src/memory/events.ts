import type { DiscordMessageSummary } from "../discord/types.js";
import type { Live2DStageState, ObsStatus } from "../live/types.js";

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
