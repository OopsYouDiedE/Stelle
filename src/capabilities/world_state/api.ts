import type { WorldSnapshot, ActionProposal, MutationResult } from "./schema.js";
import { mainReducer } from "./reducers.js";
import { allInvariants } from "./invariants.js";
import { SchemaRegistry, RoomSchema, ItemSchema, CharacterSchema } from "../world_model/registry.js";

export interface WorldStateApi {
  get_snapshot(): WorldSnapshot;
  propose_action(proposal: ActionProposal): Promise<MutationResult>;
}

export class WorldStateCapability implements WorldStateApi {
  private currentState: WorldSnapshot;
  private readonly schemaRegistry = new SchemaRegistry();

  constructor(initialState?: WorldSnapshot) {
    this.currentState = initialState || {
      version: 0,
      entities: {},
      scenes: ["default_room"],
    };
    
    // 注册默认 Schema
    this.schemaRegistry.register(RoomSchema);
    this.schemaRegistry.register(ItemSchema);
    this.schemaRegistry.register(CharacterSchema);
  }

  public get_snapshot(): WorldSnapshot {
    return { ...this.currentState };
  }

  public async propose_action(proposal: ActionProposal): Promise<MutationResult> {
    // 1. Precondition Check
    if (!proposal.actorId) {
      return { success: false, error: "Action proposal must have an actorId" };
    }

    // 2. Reducer
    const nextState = mainReducer(this.currentState, proposal);

    // 3. Schema Validation
    for (const entityId in nextState.entities) {
      const entity = nextState.entities[entityId];
      const validation = this.schemaRegistry.validate(entity.kind, entity.schemaVersion, entity.state);
      if (!validation.success) {
        return { success: false, error: `Schema validation failed for entity ${entityId}: ${validation.error}` };
      }
    }

    // 4. Invariant Check
    for (const invariant of allInvariants) {
      const result = invariant(nextState);
      if (!result.valid) {
        return { success: false, error: `Invariant violated: ${result.error}` };
      }
    }

    // 5. Versioned Commit
    this.currentState = nextState;

    return {
      success: true,
      newState: this.currentState,
      events: [{ type: "state_changed", version: this.currentState.version }],
    };
  }
}
