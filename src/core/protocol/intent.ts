export type IntentType = "respond" | "speak" | "act" | "remember" | "observe" | "update_state" | "debug";

export interface Intent<TPayload = unknown> {
  id: string;
  type: IntentType;
  sourcePackageId: string;
  targetCapability?: string;
  targetWindow?: string;
  priority: number;
  urgency?: number;
  createdAt: number;
  expiresAt?: number;
  reason: string;
  sourceEventIds?: string[];
  payload: TPayload;
  metadata?: Record<string, unknown>;
}
