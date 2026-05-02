import type { ResourceRef, StreamRef } from "./data_ref.js";

export type ExecutionCommandRisk = "read" | "safe_write" | "runtime_control" | "external_effect";
export type ExecutionResultStatus = "accepted" | "rejected" | "completed" | "failed" | "cancelled";

export interface ExecutionCommand<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  type: string;
  ownerPackageId: string;
  targetPackageId?: string;
  createdAt: number;
  risk: ExecutionCommandRisk;
  payload: TPayload;
  resourceRefs?: ResourceRef[];
  streamRefs?: StreamRef[];
  sourceIntentIds?: string[];
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutionResult<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  commandId: string;
  ownerPackageId: string;
  completedAt: number;
  status: ExecutionResultStatus;
  payload?: TPayload;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
  resourceRefs?: ResourceRef[];
  streamRefs?: StreamRef[];
  reason: string;
  metadata?: Record<string, unknown>;
}
