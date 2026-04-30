import type { ToolRegistry } from "../tool.js";
import type { StelleEventBus } from "../utils/event_bus.js";

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
  stageOwner?: {
    cursorId: string;
    topic?: string;
    expiresAt: number;
    interruptPolicy: "none" | "direct_only" | "allow_higher_priority";
  };
  autoReplyPaused?: boolean;
  ttsMuted?: boolean;
}

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
  render(intent: OutputIntent, signal?: AbortSignal): Promise<void>;
  stopCurrentOutput(): Promise<void>;
}
