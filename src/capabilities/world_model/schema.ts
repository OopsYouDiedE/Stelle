import { z } from "zod";

/**
 * 实体类型 (Entity Kind)
 */
export type EntityKind = "room" | "item" | "character" | "prop";

/**
 * 实体位置 (Entity Location)
 */
export interface EntityLocation {
  sceneId: string;
  parentId?: string; // 容器实体 ID
  position?: { x: number; y: number; z: number };
}

/**
 * 世界实体 (World Entity)
 */
export interface WorldEntity<TState = any> {
  entityId: string;
  kind: EntityKind;
  schemaVersion: string;
  name: string;
  state: TState;
  location: EntityLocation;
  tags?: string[];
}
