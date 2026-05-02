import type { ResourceRef, StreamRef } from "./data_ref.js";

export interface PerceptualActor {
  id?: string;
  displayName?: string;
  roles?: string[];
  trust?: {
    paid?: boolean;
    moderator?: boolean;
    owner?: boolean;
  };
}

export interface PerceptualEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  type: string;
  sourceWindow: string;
  occurredAt: number;
  actor?: PerceptualActor;
  payload: TPayload;
  resourceRefs?: ResourceRef[];
  streamRefs?: StreamRef[];
  priority?: "low" | "normal" | "high" | "critical";
  sourceEventIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface TextPerceptualPayload extends Record<string, unknown> {
  text: string;
  platformKind?: string;
  language?: string;
}

export interface SceneObservationPayload extends Record<string, unknown> {
  sceneRef?: string;
  summary: string;
  objects?: Array<{
    label: string;
    text?: string;
    bbox?: [number, number, number, number];
    confidence?: number;
  }>;
  confidence?: number;
}
