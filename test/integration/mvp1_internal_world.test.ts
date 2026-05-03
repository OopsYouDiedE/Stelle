import { describe, it, expect } from "vitest";
import { StelleEventBus } from "../../src/core/event/event_bus.js";
import { InternalWorldWindow } from "../../src/windows/internal_world/runtime.js";
import { ContextStateCapability } from "../../src/capabilities/context_state/api.js";
import { WorldStateCapability } from "../../src/capabilities/world_state/api.js";
import { WorldSimulation } from "../../src/capabilities/world_simulation/api.js";

describe("MVP-1 Internal World integration", () => {
  it("should respond to world state requests and emit versioned watermarks", async () => {
    const eventBus = new StelleEventBus();
    const contextState = new ContextStateCapability();
    const worldState = new WorldStateCapability();
    const simulation = new WorldSimulation();
    const worldWin = new InternalWorldWindow({ eventBus, contextState, worldState, simulation });

    // 监控 world.state.changed
    const statePromise = new Promise((resolve) => {
      eventBus.subscribe("world.state.changed", (event) => {
        resolve(event);
      });
    });

    // 请求状态
    eventBus.publish({
      type: "world.state.requested",
      source: "test",
      id: "req-001",
      correlationId: "corr-002",
    });

    const stateEvent = await statePromise as any;
    expect(stateEvent.payload.contextState).toBeDefined();
    expect(stateEvent.payload.worldState).toBeDefined();
    expect(stateEvent.watermarks.world.context).toBe(0);

    // 更新状态并再次请求
    contextState.update_state({ activeTopic: "AI architecture" });
    
    const statePromise2 = new Promise((resolve) => {
      eventBus.subscribe("world.state.changed", (event) => {
        resolve(event);
      });
    });

    eventBus.publish({
      type: "world.state.requested",
      source: "test",
      id: "req-002",
      correlationId: "corr-003",
    });

    const stateEvent2 = await statePromise2 as any;
    expect(stateEvent2.payload.contextState.activeTopic).toBe("AI architecture");
    expect(stateEvent2.watermarks.world.context).toBe(1);
  });
});
