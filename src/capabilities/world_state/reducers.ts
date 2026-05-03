import type { WorldSnapshot, ActionProposal } from "./schema.js";

/**
 * Reducer 定义
 */
export type Reducer = (state: WorldSnapshot, proposal: ActionProposal) => WorldSnapshot;

/**
 * 移动实体的 Reducer
 */
export const moveEntityReducer: Reducer = (state, proposal) => {
  const { entityId, newLocation } = proposal.payload;
  const entity = state.entities[entityId];
  
  if (!entity) return state;

  const newEntities = {
    ...state.entities,
    [entityId]: {
      ...entity,
      location: {
        ...entity.location,
        ...newLocation,
      },
    },
  };

  return {
    ...state,
    entities: newEntities,
    version: state.version + 1,
  };
};

/**
 * 更新实体状态的 Reducer
 */
export const updateEntityStateReducer: Reducer = (state, proposal) => {
  const { entityId, patch } = proposal.payload;
  const entity = state.entities[entityId];
  
  if (!entity) return state;

  const newEntities = {
    ...state.entities,
    [entityId]: {
      ...entity,
      state: {
        ...entity.state,
        ...patch,
      },
    },
  };

  return {
    ...state,
    entities: newEntities,
    version: state.version + 1,
  };
};

export const mainReducer: Reducer = (state, proposal) => {
  switch (proposal.type) {
    case "MOVE_ENTITY":
      return moveEntityReducer(state, proposal);
    case "UPDATE_ENTITY_STATE":
      return updateEntityStateReducer(state, proposal);
    default:
      return state;
  }
};
