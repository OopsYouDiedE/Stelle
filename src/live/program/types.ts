import type { LiveEventKind, LiveEventSource } from "../../utils/live_event.js";
import type { PublicRoomMemory } from "./public_memory.js";
import type { WorldCanonEntry } from "./world_canon.js";
import type { PromptLabExperiment } from "./prompt_lab.js";

export type ProgramMode =
  | "observation"
  | "court"
  | "lab"
  | "archive"
  | "diagnosis"
  | "story"
  | "reflection";

export type TopicPhase =
  | "opening"
  | "sampling"
  | "clustering"
  | "debating"
  | "summarizing"
  | "closing";

export type ChatClusterLabel =
  | "question"
  | "opinion"
  | "joke"
  | "setting_suggestion"
  | "challenge"
  | "other";

export type ProgramWidgetName =
  | "topic_compass"
  | "chat_cluster"
  | "conclusion_board"
  | "question_queue"
  | "public_memory_wall"
  | "stage_status"
  | "world_canon"
  | "prompt_lab"
  | "anonymous_community_map";

export interface ChatCluster {
  label: ChatClusterLabel;
  count: number;
  representative?: string;
}

export interface ProgramEventSample {
  id: string;
  source: LiveEventSource;
  kind: LiveEventKind;
  text: string;
  receivedAt: number;
  priority: "low" | "medium" | "high";
}

export interface TopicState {
  topicId: string;
  title: string;
  mode: ProgramMode;
  phase: TopicPhase;
  currentQuestion: string;
  nextQuestion?: string;
  clusters: ChatCluster[];
  conclusions: string[];
  pendingQuestions: string[];
  scene: ProgramMode;
  lastUpdatedAt: number;
}

export interface ChatClusterState {
  clusters: ChatCluster[];
  samples: ProgramEventSample[];
  updatedAt: number;
}

export interface StageStatusWidgetState {
  stage?: Record<string, unknown>;
  health?: Record<string, unknown>;
  updatedAt: number;
}

export interface ProgramWidgetState {
  topic_compass: TopicState;
  chat_cluster: ChatClusterState;
  conclusion_board: { conclusions: string[]; updatedAt: number };
  question_queue: { pendingQuestions: string[]; updatedAt: number };
  stage_status: StageStatusWidgetState;
  public_memory_wall: { memories: PublicRoomMemory[]; updatedAt: number };
  world_canon: { entries: WorldCanonEntry[]; updatedAt: number };
  prompt_lab: { experiments: PromptLabExperiment[]; updatedAt: number };
}

export interface TopicOrchestratorOptions {
  topicId?: string;
  title?: string;
  mode?: ProgramMode;
  templateId?: string;
  currentQuestion?: string;
  nextQuestion?: string;
  maxSamples?: number;
  maxPendingQuestions?: number;
  now?: () => number;
}
