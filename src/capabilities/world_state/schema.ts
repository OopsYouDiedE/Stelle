import { z } from "zod";
import type { WorldEntity } from "../world_model/schema.js";

/**
 * 世界状态快照 (World State Snapshot)
 */
export interface WorldSnapshot {
  version: number;
  entities: Record<string, WorldEntity>;
  scenes: string[];
}

/**
 * 状态变更提议 (Action Proposal)
 */
export interface ActionProposal {
  type: string;
  actorId: string;
  payload: any;
}

/**
 * 变更结果
 */
export interface MutationResult {
  success: boolean;
  newState?: WorldSnapshot;
  error?: string;
  events?: any[];
}
