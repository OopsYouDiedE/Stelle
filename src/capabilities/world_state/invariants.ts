import type { WorldSnapshot } from "./schema.js";

/**
 * 不变量检查 (Invariant Check)
 */
export type Invariant = (state: WorldSnapshot) => { valid: boolean; error?: string };

/**
 * 唯一包含不变量: 同一实体不能在两个位置，且 parentId 必须存在。
 */
export const uniqueContainmentInvariant: Invariant = (state) => {
  for (const entityId in state.entities) {
    const entity = state.entities[entityId];
    if (entity.location.parentId && !state.entities[entity.location.parentId]) {
      return { valid: false, error: `Entity ${entityId} has non-existent parent ${entity.location.parentId}` };
    }
  }
  return { valid: true };
};

/**
 * 场景一致性不变量: 所有实体的 sceneId 必须在 scenes 列表中。
 */
export const sceneConsistencyInvariant: Invariant = (state) => {
  for (const entityId in state.entities) {
    const entity = state.entities[entityId];
    if (!state.scenes.includes(entity.location.sceneId)) {
      return { valid: false, error: `Entity ${entityId} is in non-existent scene ${entity.location.sceneId}` };
    }
  }
  return { valid: true };
};

export const allInvariants: Invariant[] = [
  uniqueContainmentInvariant,
  sceneConsistencyInvariant,
];
