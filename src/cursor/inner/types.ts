import type { BehaviorPolicy } from "../types.js";

export interface CursorDirectiveEnvelope {
  target: "discord" | "discord_text_channel" | "live" | "live_danmaku" | "browser" | "desktop_input" | "android_device" | "global";
  action: string;
  policy?: BehaviorPolicy;
  priority: number;
  expiresAt?: number;
}

export interface CognitiveSignal {
  id: string;
  source: "discord_text_channel" | "live_danmaku" | "stage_output" | "browser" | "system";
  kind: string;
  summary: string;
  timestamp: number;
  impactScore: number;
  salience: "low" | "medium" | "high";
  evidence?: Array<{ source: string; excerpt: string; timestamp?: number }>;
  metadata?: Record<string, unknown>;
}

export interface ResearchEvidence {
  source: string;
  excerpt: string;
  timestamp: number;
}

export interface ResearchAction {
  type: string;
  description: string;
  status: "pending" | "completed";
}

export interface ResearchTopic {
  id: string;
  title: string;
  subjectKind: "person" | "community" | "theme" | "relationship" | "self" | "stream";
  status: "active" | "cooling" | "closed";
  priority: number;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  evidence: ResearchEvidence[];
  openQuestions: string[];
  provisionalFindings: string[];
  nextActions: ResearchAction[];
}

export interface FieldNote {
  id: string;
  topicId?: string;
  source: "live" | "discord" | "memory" | "browser" | "system";
  excerpt: string;
  streamUse: "cold_open" | "callback" | "bridge_topic" | "avoid" | "question";
  vibe: "quiet" | "curious" | "playful" | "tense" | "technical" | "emotional";
  safety: "safe" | "sensitive" | "avoid";
  createdAt: number;
}

export interface SelfModelSnapshot {
  mood: string;
  currentFocus: string;
  activeConvictions: Array<{ topic: string; stance: string; confidence: number }>;
  behavioralWarnings: string[];
  styleBias: {
    replyBias?: "aggressive" | "normal" | "selective" | "silent";
    vibeIntensity?: number;
    preferredTempo?: "slow" | "normal" | "quick";
  };
}

export interface ReflectionDecision {
  mode: "none" | "quick" | "research" | "core" | "identity_review";
  reason: string;
}

export type ReflectionMode = ReflectionDecision["mode"];

export interface ResearchAgendaUpdate {
  addedTopics: ResearchTopic[];
  updatedTopics: ResearchTopic[];
  closedTopics: ResearchTopic[];
}

export interface FieldSamplingInput {
  activeTopics: ResearchTopic[];
  recentSignals: CognitiveSignal[];
  selfModel: SelfModelSnapshot;
}

export interface FieldSamplingResult {
  notes: FieldNote[];
  recommendedFocus?: string;
}

export interface SelfModelUpdateInput {
  signals: CognitiveSignal[];
  researchUpdates: ResearchAgendaUpdate;
}

export interface SelfModelUpdate {
  snapshot: SelfModelSnapshot;
  changes: string[];
}

export interface DirectivePlanningInput {
  selfModel: SelfModelSnapshot;
  activeTopics: ResearchTopic[];
  fieldNotes: FieldNote[];
  now?: number;
}

export interface IdentityProposal {
  id: string;
  change: string;
  rationale: string;
  confidence: number;
}
