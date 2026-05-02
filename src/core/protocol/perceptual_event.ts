export interface PerceptualEvent<TPayload = unknown> {
  id: string;
  type: string;
  sourceWindow: string;
  sourceCapability?: string;
  actorId?: string;
  sessionId?: string;
  timestamp: number;
  ttlMs?: number;
  salienceHint?: number;
  payload: TPayload;
  metadata?: Record<string, unknown>;
}
