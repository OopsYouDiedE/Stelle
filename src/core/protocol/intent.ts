import type { ResourceRef, StreamRef } from "./data_ref.js";

export type IntentPriority = "low" | "normal" | "high" | "critical";
export type IntentStatus = "proposed" | "accepted" | "queued" | "rejected" | "completed" | "failed";

export interface Intent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  type: string;
  ownerPackageId: string;
  createdAt: number;
  priority: IntentPriority;
  payload: TPayload;
  resourceRefs?: ResourceRef[];
  streamRefs?: StreamRef[];
  sourceEventIds?: string[];
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface StageOutputIntentPayload extends Record<string, unknown> {
  lane: "emergency" | "direct_response" | "topic_hosting" | "live_chat" | "ambient" | "inner_reaction" | "debug";
  text: string;
  summary?: string;
  salience: "low" | "medium" | "high" | "critical";
  interrupt: "none" | "soft" | "hard";
  ttlMs: number;
  output?: {
    caption?: boolean;
    tts?: boolean;
    motion?: string;
    expression?: string;
  };
}

export interface IntentDecision {
  intentId: string;
  status: IntentStatus;
  reason: string;
  ownerPackageId: string;
  createdAt: number;
}
