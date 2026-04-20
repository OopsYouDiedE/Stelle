export interface MemoryReflection {
  experienceId: string;
  sourceCursorId: string;
  sourceKind: string;
  experienceType: string;
  summary: string;
  reason: string;
  salience: number;
  createdAt: number;
}

export interface MemoryEntry extends MemoryReflection {
  id: string;
  writtenAt: number;
}

export interface MemoryStoreSnapshot {
  path: string;
  writtenCount: number;
  lastWrittenAt: number | null;
}
