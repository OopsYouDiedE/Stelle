import type { Message, Typing } from "discord.js";
import type { CursorActivation, CursorHost, CursorReport } from "../base.js";
import type { DiscordChannelSnapshot } from "./runtime.js";

export interface DiscordCursor extends CursorHost {
  kind: "discord";
  snapshot(): Promise<DiscordSnapshot>;
}

export type DiscordActivation =
  | (CursorActivation & {
      type: "message_create";
      payload: { message: Message };
    })
  | (CursorActivation & {
      type: "typing_start";
      payload: { typing: Typing };
    })
  | CursorActivation;

export interface DiscordCursorContext {
  queuedActivations: DiscordActivation[];
  lastActivatedAt: number | null;
  lastProcessedAt: number | null;
  lastActivationType: string | null;
  lastChannelId: string | null;
  processing: boolean;
  recentReports: CursorReport[];
  channelStates: Map<string, DiscordChannelSnapshot>;
}

export interface DiscordSnapshot {
  cursorId: string;
  kind: "discord";
  status: "idle" | "active" | "error";
  queueLength: number;
  queuedActivationTypes: string[];
  lastActivatedAt: number | null;
  lastProcessedAt: number | null;
  lastActivationType: string | null;
  lastChannelId: string | null;
  knownChannelCount: number;
  channels: DiscordChannelSnapshot[];
}

export interface DiscordJudgeDecision {
  focus: string | null;
  intent: Record<string, unknown>;
  trigger: Record<string, unknown>;
  recallUserId: string | null;
}
