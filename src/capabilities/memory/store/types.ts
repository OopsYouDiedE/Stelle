export type MemoryScope =
  | { kind: "discord_channel"; channelId: string; guildId?: string | null }
  | { kind: "discord_global" }
  | { kind: "live" }
  | { kind: "long_term" };

export interface MemoryEntry {
  id: string;
  timestamp: number;
  source: "discord" | "live" | "core" | "debug";
  type: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface HistorySummary {
  scope: MemoryScope;
  path: string;
  excerpt: string;
  score: number;
}

export interface MemorySearchQuery {
  text?: string;
  keywords?: string[];
  limit?: number;
  layers?: MemoryLayer[];
}

export interface ResearchLog {
  id?: string;
  timestamp?: number;
  focus: string;
  process: string[];
  conclusion: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryStoreOptions {
  rootDir?: string;
  recentLimit?: number;
  compactionEnabled?: boolean;
  llm?: import("../../model/llm.js").LlmClient;
}

export const MEMORY_LAYERS = ["observations", "user_facts", "self_state", "core_identity", "research_logs"] as const;
export type MemoryLayer = (typeof MEMORY_LAYERS)[number];

export interface MemoryProposal {
  id: string;
  timestamp: number;
  authorId: string;
  source: string;
  content: string;
  reason: string;
  layer: MemoryLayer;
}

export type MemoryProposalStatus = "pending" | "approved" | "rejected";

export interface MemoryProposalDecision {
  id: string;
  proposalId: string;
  timestamp: number;
  status: Exclude<MemoryProposalStatus, "pending">;
  decidedBy: string;
  reason?: string;
  targetKey?: string;
  layer?: MemoryLayer;
}

export interface MemoryProposalView extends MemoryProposal {
  status: MemoryProposalStatus;
  decision?: MemoryProposalDecision;
}
