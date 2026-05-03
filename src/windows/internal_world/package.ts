import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../core/protocol/component.js";
import { InternalWorldWindow } from "./runtime.js";
import { ContextStateCapability } from "../../capabilities/context_state/api.js";
import { WorldStateCapability } from "../../capabilities/world_state/api.js";
import { WorldSimulation } from "../../capabilities/world_simulation/api.js";
import type { StelleEventBus } from "../../core/event/event_bus.js";

export const internalWorldPackage: ComponentPackage = {
  id: "window.internal_world",
  kind: "window",
  version: "1.0.0",
  displayName: "Internal World Window",

  provides: [
    { id: "window.internal_world", kind: "service" },
  ],

  register(ctx: ComponentRegisterContext) {
    const eventBus = ctx.registry.resolve<StelleEventBus>("core.event_bus");
    const contextState = new ContextStateCapability();
    const worldState = new WorldStateCapability();
    const simulation = new WorldSimulation();

    const window = new InternalWorldWindow({
      eventBus: eventBus!,
      contextState,
      worldState,
      simulation,
    });

    ctx.registry.provide("window.internal_world", window);
    ctx.registry.provide("capabilities.context_state", contextState);
    ctx.registry.provide("capabilities.world_state", worldState);
    ctx.registry.provide("capabilities.world_simulation", simulation);
  },

  async start(ctx: ComponentRuntimeContext) {},
  async stop(ctx: ComponentRuntimeContext) {},
};
