import { describe, it, expect } from "vitest";
import { StelleEventBus } from "../../src/core/event/event_bus.js";
import { InternalWorldWindow } from "../../src/windows/internal_world/runtime.js";
import { ContextStateCapability } from "../../src/capabilities/context_state/api.js";
import { WorldStateCapability } from "../../src/capabilities/world_state/api.js";
import { WorldSimulation } from "../../src/capabilities/world_simulation/api.js";

describe("MVP-2 Formal World State integration", () => {
  it("should handle formal action proposals and enforce invariants", async () => {
    const eventBus = new StelleEventBus();
    const contextState = new ContextStateCapability();
    const worldState = new WorldStateCapability({
      version: 0,
      entities: {
        "item-1": {
          entityId: "item-1",
          kind: "item",
          schemaVersion: "1.0.0",
          name: "Test Item",
          state: {},
          location: { sceneId: "default_room" },
        }
      },
      scenes: ["default_room"],
    });
    const simulation = new WorldSimulation();
    
    const worldWin = new InternalWorldWindow({ eventBus, contextState, worldState, simulation });

    // 1. 测试合法移动
    const completionPromise = new Promise((resolve) => {
      eventBus.subscribe("world.action.completed", (event) => {
        resolve(event);
      });
    });

    eventBus.publish({
      type: "world.action.propose",
      source: "test",
      payload: {
        type: "MOVE_ENTITY",
        actorId: "test-actor",
        payload: { entityId: "item-1", newLocation: { sceneId: "default_room", position: { x: 1, y: 0, z: 0 } } }
      }
    });

    const result = await completionPromise as any;
    expect(result.payload.success).toBe(true);
    expect(worldState.get_snapshot().entities["item-1"].location.position?.x).toBe(1);

    // 2. 测试不变量违反 (移动到不存在的 parent)
    const completionPromise2 = new Promise((resolve) => {
      eventBus.subscribe("world.action.completed", (event) => {
        resolve(event);
      });
    });

    eventBus.publish({
      type: "world.action.propose",
      source: "test",
      payload: {
        type: "MOVE_ENTITY",
        actorId: "test-actor",
        payload: { entityId: "item-1", newLocation: { sceneId: "default_room", parentId: "non-existent" } }
      }
    });

    const result2 = await completionPromise2 as any;
    expect(result2.payload.success).toBe(false);
    expect(result2.payload.error).toContain("Invariant violated");
  });
});
