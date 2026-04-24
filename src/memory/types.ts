export const MEMORY_COLLECTIONS = [
  "people",
  "relationships",
  "experiences",
  "guilds",
  "channels",
  "summaries",
] as const;

export type MemoryCollection = (typeof MEMORY_COLLECTIONS)[number];

export interface MemoryRecord {
  id: string;
  collection: MemoryCollection;
  type: string;
  source: string;
  updatedAt: string;
  createdAt?: string;
  title?: string;
  tags: string[];
  relatedIds?: string[];
  content: string;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchQuery {
  collection?: MemoryCollection;
  id?: string;
  tag?: string;
  query?: string;
  limit?: number;
}

export interface MemorySearchResult {
  record: MemoryRecord;
  path: string;
  excerpt: string;
  score: number;
}

export interface MemoryCollectionStats {
  collection: MemoryCollection;
  count: number;
}
