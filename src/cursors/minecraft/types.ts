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

export interface MinecraftObservation {
  connected: boolean;
  spawned: boolean;
  username: string | null;
  host: string | null;
  port: number | null;
  health: number | null;
  food: number | null;
  dimension: string | null;
  position: MinecraftPosition | null;
  knownPlayers: MinecraftPlayerSummary[];
  timestamp: number;
}

export type MinecraftAction =
  | { type: "connect"; input: MinecraftConnectionConfig }
  | { type: "disconnect" }
  | { type: "chat"; input: { message: string } }
  | { type: "inspect" }
  | { type: "goto"; input: { x: number; y: number; z: number; range?: number } }
  | { type: "follow_player"; input: { username: string; range?: number } }
  | { type: "stop" };

export interface MinecraftRunRequest {
  id: string;
  action: MinecraftAction;
  note?: string;
  createdAt: number;
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
  actionResult?: MinecraftActionResult;
  observation?: MinecraftObservation;
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
  snapshot(): Promise<MinecraftSnapshot>;
}
