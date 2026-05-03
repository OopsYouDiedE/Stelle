import { z } from "zod";
import type { EntityKind } from "../world_model/schema.js";

/**
 * 实体 Schema 定义 (Entity Schema)
 */
export interface EntitySchema<TState = any> {
  kind: EntityKind;
  version: string;
  zodSchema: z.ZodSchema<TState>;
  defaultState(): TState;
}

/**
 * Schema 注册表 (Schema Registry)
 */
export class SchemaRegistry {
  private schemas = new Map<string, EntitySchema>();

  public register(schema: EntitySchema): void {
    const key = `${schema.kind}:${schema.version}`;
    this.schemas.set(key, schema);
  }

  public get(kind: EntityKind, version: string): EntitySchema | undefined {
    return this.schemas.get(`${kind}:${version}`);
  }

  public validate(kind: EntityKind, version: string, state: unknown): { success: boolean; error?: string; data?: any } {
    const schema = this.get(kind, version);
    if (!schema) {
      return { success: false, error: `Schema not found: ${kind}:${version}` };
    }
    const result = schema.zodSchema.safeParse(state);
    if (!result.success) {
      return { success: false, error: result.error.message };
    }
    return { success: true, data: result.data };
  }
}

/**
 * 默认房间 Schema
 */
export const RoomSchema: EntitySchema = {
  kind: "room",
  version: "1.0.0",
  zodSchema: z.object({
    isLit: z.boolean().default(true),
    cleanliness: z.number().min(0).max(10).default(10),
  }),
  defaultState() {
    return { isLit: true, cleanliness: 10 };
  },
};

/**
 * 默认角色 Schema
 */
export const CharacterSchema: EntitySchema = {
  kind: "character",
  version: "1.0.0",
  zodSchema: z.object({
    mood: z.string().default("neutral"),
    health: z.number().min(0).max(100).default(100),
  }),
  defaultState() {
    return { mood: "neutral", health: 100 };
  },
};

/**
 * 默认物品 Schema
 */
export const ItemSchema: EntitySchema = {
  kind: "item",
  version: "1.0.0",
  zodSchema: z.object({
    isMovable: z.boolean().default(true),
    weightKg: z.number().optional(),
  }),
  defaultState() {
    return { isMovable: true };
  },
};
