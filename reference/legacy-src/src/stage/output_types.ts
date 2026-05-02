// === Imports ===
import type { ToolRegistry } from "../tool.js";
import type { StelleEventBus } from "../utils/event_bus.js";

// === Intent & Salience ===
export type OutputLane =
  | "emergency"
  | "direct_response"
  | "topic_hosting"
  | "live_chat"
  | "ambient"
  | "inner_reaction"
  | "debug";

export type OutputSalience = "low" | "medium" | "high" | "critical";
export type OutputInterrupt = "none" | "soft" | "hard";
export type OutputDecisionStatus = "accepted" | "queued" | "dropped" | "interrupted";

export interface OutputIntent {
  id: string;
  cursorId: string;
  createdAt?: number;
  sourceEventId?: string;
  groupId?: string;
  sequence?: number;
  lane: OutputLane;
  priority: number;
  salience: OutputSalience;
  text: string;
  summary?: string;
  topic?: string;
  mergeKey?: string;
  ttlMs: number;
  interrupt: OutputInterrupt;
  estimatedDurationMs?: number;
  output: {
    caption?: boolean;
    tts?: boolean;
    motion?: string;
    expression?: string;
    discordReply?: {
      channelId: string;
      messageId?: string;
    };
  };
  metadata?: Record<string, unknown>;
}

// === State & Decision ===
export interface StageOutputRecord {
  id: string;
  cursorId: string;
  lane: OutputLane;
  text: string;
  status: "started" | "completed" | "dropped" | "interrupted";
  reason?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface StageQueuedOutputSnapshot {
  id: string;
  cursorId: string;
  lane: OutputLane;
  groupId?: string;
  sequence?: number;
  createdAt: number;
  priority: number;
  salience: OutputSalience;
  text: string;
  enqueuedAt: number;
  ttlMs: number;
  ttlRemainingMs: number;
}

export type StageOutputDeliveryTarget =
  | "live.caption"
  | "live.tts"
  | "live.panel"
  | "live.motion"
  | "live.expression"
  | "discord.reply";

export interface StageOutputDeliveryRecord {
  target: StageOutputDeliveryTarget;
  ok: boolean;
  summary: string;
  errorCode?: string;
}

export interface StageOutputDeliveryReport {
  outputId: string;
  records: StageOutputDeliveryRecord[];
}

export interface StageOutputDecision {
  status: OutputDecisionStatus;
  outputId: string;
  reason: string;
  intent?: OutputIntent;
  queueLength?: number;
}

export interface StageOutputState {
  id: "stage_output";
  status: "idle" | "speaking" | "queued";
  speaking: boolean;
  currentOutputId?: string;
  currentOwner?: string;
  currentLane?: OutputLane;
  currentTopic?: string;
  captionBusyUntil: number;
  ttsBusyUntil: number;
  motionBusyUntil: number;
  queueLength: number;
  recentOutputs: StageOutputRecord[];
  queuedOutputs?: StageQueuedOutputSnapshot[];
  stageOwner?: {
    cursorId: string;
    topic?: string;
    expiresAt: number;
    interruptPolicy: "none" | "direct_only" | "allow_higher_priority";
  };
  autoReplyPaused?: boolean;
  ttsMuted?: boolean;
}

// === Renderer & Arbiter Interfaces ===
export interface StageOutputRendererDeps {
  tools: ToolRegistry;
  cwd: string;
  ttsEnabled: boolean;
}

export interface StageOutputArbiterDeps {
  renderer: StageOutputRenderer;
  eventBus?: StelleEventBus;
  now: () => number;
  debugEnabled?: boolean;
  maxQueueLength?: number;
  quietIntervalMs?: number;
}

export interface StageOutputRenderer {
  render(intent: OutputIntent, signal?: AbortSignal): Promise<void | StageOutputDeliveryReport>;
  stopCurrentOutput(): Promise<void>;
}
