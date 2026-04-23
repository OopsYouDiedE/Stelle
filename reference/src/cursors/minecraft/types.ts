import type { CursorActivation, CursorHost, CursorReport } from "../base.js";

export type MinecraftCursorStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "spawning"
  | "active"
  | "error";

export interface MinecraftConnectionConfig {
  host: string;
  username: string;
  port?: number;
  version?: string | false;
  auth?: "offline" | "microsoft" | "mojang";
  password?: string;
}

export interface MinecraftPosition {
  x: number;
  y: number;
  z: number;
}

export interface MinecraftPlayerSummary {
  username: string;
  displayName?: string | null;
  position?: MinecraftPosition | null;
}

export interface MinecraftInventoryItemSummary {
  name: string;
  count: number;
  slot: number;
}

export interface MinecraftBlockSummary {
  name: string;
  position: MinecraftPosition;
  distance: number;
}

export interface MinecraftEntitySummary {
  id: number;
  name: string;
  type: string;
  username?: string | null;
  position: MinecraftPosition | null;
  distance: number | null;
}

export interface MinecraftObservation {
  connected: boolean;
  spawned: boolean;
  username: string | null;
  host: string | null;
  port: number | null;
  gameMode: string | null;
  health: number | null;
  food: number | null;
  dimension: string | null;
  position: MinecraftPosition | null;
  inventory: MinecraftInventoryItemSummary[];
  nearbyBlocks: MinecraftBlockSummary[];
  nearbyEntities: MinecraftEntitySummary[];
  knownPlayers: MinecraftPlayerSummary[];
  timestamp: number;
}

export interface MinecraftEnvironmentImage {
  path: string;
  mimeType: string;
  description: string;
  timestamp: number;
}

export interface MinecraftEnvironmentFrame {
  observation: MinecraftObservation;
  image: MinecraftEnvironmentImage | null;
  summary: string;
  timestamp: number;
}

export type MinecraftAction =
  | { type: "connect"; input: MinecraftConnectionConfig }
  | { type: "disconnect" }
  | { type: "chat"; input: { message: string } }
  | { type: "inspect" }
  | { type: "inventory_snapshot"; input?: { limit?: number } }
  | { type: "nearby_blocks"; input?: { range?: number; limit?: number } }
  | { type: "nearby_entities"; input?: { range?: number; limit?: number } }
  | {
      type: "give_creative_item";
      input: { item: string; count?: number; slot?: number };
    }
  | {
      type: "equip_item";
      input: { item: string; destination?: "hand" | "head" | "torso" | "legs" | "feet" | "off-hand" };
    }
  | {
      type: "mine_block_at";
      input: { position: MinecraftPosition; timeoutMs?: number };
    }
  | {
      type: "place_block_at";
      input: {
        item: string;
        position: MinecraftPosition;
        method?: "auto" | "command" | "hand";
      };
    }
  | {
      type: "collect_blocks";
      input: { block: string; count?: number; range?: number };
    }
  | {
      type: "craft_recipe";
      input: {
        item: string;
        count?: number;
        useCraftingTable?: boolean;
        creativeFallback?: boolean;
      };
    }
  | { type: "set_follow_target"; input: { username: string; range?: number } }
  | { type: "clear_follow_target" }
  | { type: "prepare_wooden_pickaxe" }
  | {
      type: "build_wooden_house";
      input?: {
        origin?: MinecraftPosition;
        width?: number;
        depth?: number;
        height?: number;
      };
    }
  | { type: "goto"; input: { x: number; y: number; z: number; range?: number } }
  | { type: "follow_player"; input: { username: string; range?: number } }
  | { type: "stop" };

export interface MinecraftRunRequest {
  id: string;
  action: MinecraftAction;
  note?: string;
  createdAt: number;
}

export interface MinecraftJudgeInput {
  request: MinecraftRunRequest;
  context: Pick<
    MinecraftCursorContext,
    "connection" | "activeRequest" | "lastObservation"
  >;
}

export interface MinecraftJudgeResult {
  executable: boolean;
  reason: string;
  actionPlan: MinecraftAction;
}

export interface MinecraftActionResult {
  ok: boolean;
  actionType: MinecraftAction["type"];
  summary: string;
  timestamp: number;
}

export interface MinecraftRunResult {
  requestId: string;
  ok: boolean;
  summary: string;
  judge: MinecraftJudgeResult;
  actionResult?: MinecraftActionResult;
  observation?: MinecraftObservation;
  reports: CursorReport[];
}

export type MinecraftStrategyDecision =
  | {
      type: "continue";
      action: MinecraftAction;
      expectation: string;
      waitMs?: number;
    }
  | {
      type: "switch_strategy";
      strategyId: string;
      reason: string;
    }
  | {
      type: "wait";
      reason: string;
      waitMs: number;
    }
  | {
      type: "complete";
      summary: string;
    }
  | {
      type: "fail";
      reason: string;
    };

export interface MinecraftStrategyContext {
  strategyId: string;
  startedAt: number;
  stepCount: number;
  maxSteps: number;
  lastActionResult?: MinecraftActionResult;
  notes: string[];
}

export interface MinecraftStrategyJudgeInput {
  frame: MinecraftEnvironmentFrame;
  strategy: MinecraftStrategyContext;
  decision: MinecraftStrategyDecision;
}

export interface MinecraftStrategyJudgeResult {
  executable: boolean;
  reason: string;
  decision: MinecraftStrategyDecision;
  actionJudge?: MinecraftJudgeResult;
}

export interface MinecraftStrategyRunRequest {
  id: string;
  strategyId: string;
  maxSteps?: number;
  note?: string;
  createdAt: number;
}

export interface MinecraftStrategyStepResult {
  index: number;
  frame: MinecraftEnvironmentFrame;
  judge: MinecraftStrategyJudgeResult;
  actionResult?: MinecraftActionResult;
  summary: string;
}

export interface MinecraftStrategyRunResult {
  requestId: string;
  strategyId: string;
  ok: boolean;
  summary: string;
  steps: MinecraftStrategyStepResult[];
  finalFrame: MinecraftEnvironmentFrame;
  reports: CursorReport[];
}

export interface MinecraftSnapshot {
  cursorId: string;
  kind: "minecraft";
  status: MinecraftCursorStatus;
  summary: string;
  activeRequestId: string | null;
  connection: MinecraftConnectionConfig | null;
  lastObservation: MinecraftObservation | null;
  lastReportAt: number | null;
}

export interface MinecraftCursorContext {
  connection: MinecraftConnectionConfig | null;
  activeRequest: MinecraftRunRequest | null;
  lastObservation: MinecraftObservation | null;
  recentActivations: CursorActivation[];
  recentReports: CursorReport[];
  lastActivatedAt: number | null;
  lastReportAt: number | null;
}

export type MinecraftActivation =
  | (CursorActivation & {
      type: "minecraft_connect";
      payload: { config: MinecraftConnectionConfig };
    })
  | (CursorActivation & {
      type: "minecraft_disconnect";
    })
  | CursorActivation;

export interface MinecraftCursor extends CursorHost {
  kind: "minecraft";
  connect(config: MinecraftConnectionConfig): Promise<MinecraftActionResult>;
  disconnect(): Promise<MinecraftActionResult>;
  run(request: MinecraftRunRequest): Promise<MinecraftRunResult>;
  runStrategy(request: MinecraftStrategyRunRequest): Promise<MinecraftStrategyRunResult>;
  readEnvironmentFrame(): Promise<MinecraftEnvironmentFrame>;
  snapshot(): Promise<MinecraftSnapshot>;
}
