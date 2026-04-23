import type { WindowRegistrySnapshot } from "../core/windowRegistry.js";
import type { CursorActivation, CursorReport } from "../cursors/base.js";
import type {
  MemoryReflection,
  MemoryStoreSnapshot,
} from "./memory/types.js";
import type { ConsciousnessStrategyDecision } from "./consciousness/types.js";
import type {
  ConsciousnessCommitment,
  ConsciousnessGoal,
} from "./consciousness/types.js";

export type {
  MemoryReflection,
  MemoryStoreSnapshot,
} from "./memory/types.js";

export interface AttentionActivation {
  cursorId: string;
  activation: CursorActivation;
}

export interface AttentionCycleResult {
  reports: CursorReport[];
  idleActivations: AttentionActivation[];
  memoryReflections: MemoryReflection[];
  decisions: ConsciousnessStrategyDecision[];
  ranConsciousness: boolean;
  timestamp: number;
}

export interface Experience {
  id: string;
  sourceCursorId: string;
  sourceKind: string;
  type: string;
  summary: string;
  payload?: unknown;
  salience: number;
  occurredAt: number;
  receivedAt: number;
}

export interface ExperienceStoreSnapshot {
  totalCount: number;
  recent: Experience[];
}

export interface StelleSnapshot {
  identity: "Stelle";
  windows: WindowRegistrySnapshot;
  experience: ExperienceStoreSnapshot;
  memory: MemoryStoreSnapshot;
  consciousness: ConsciousnessSnapshot;
}

export interface ConsciousnessSnapshot {
  id: string;
  kind: "consciousness";
  currentFocusCursorId: string | null;
  lastReflectionAt: number | null;
  observedExperienceCount: number;
  activeGoals: ConsciousnessGoal[];
  activeCommitments: ConsciousnessCommitment[];
  lastDecisions: ConsciousnessStrategyDecision[];
}

export interface ConsciousnessIdleContext {
  windows: WindowRegistrySnapshot;
  recentExperiences: Experience[];
  timestamp: number;
}

export interface ConsciousnessIdleResult {
  reports: CursorReport[];
  idleActivations: AttentionActivation[];
  memoryReflections: MemoryReflection[];
  decisions: ConsciousnessStrategyDecision[];
}

export type { ConsciousnessStrategyDecision } from "./consciousness/types.js";
