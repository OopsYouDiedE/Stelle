export interface ExecutionCommand<TPayload = unknown> {
  id: string;
  targetCapability: string;
  targetWindow?: string;
  action: string;
  priority: number;
  createdAt: number;
  ttlMs?: number;
  reason: string;
  payload: TPayload;
  metadata?: Record<string, unknown>;
}

export type ExecutionStatus =
  | "accepted"
  | "queued"
  | "started"
  | "completed"
  | "failed"
  | "cancelled"
  | "dropped"
  | "interrupted";

export interface ExecutionResult<TPayload = unknown> {
  commandId: string;
  status: ExecutionStatus;
  reason?: string;
  timestamp: number;
  payload?: TPayload;
  metadata?: Record<string, unknown>;
}
