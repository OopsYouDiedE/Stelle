export interface CursorActivation {
  type: string;
  reason: string;
  payload?: Record<string, unknown>;
  timestamp: number;
}

export interface CursorReport {
  cursorId: string;
  type: string;
  summary: string;
  payload?: Record<string, unknown>;
  timestamp: number;
}

export interface CursorHost {
  id: string;
  kind: string;

  activate(input: CursorActivation): Promise<void>;
  tick(): Promise<CursorReport[]>;
}
