import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../core/protocol/component.js";
import { InternalInteractionWindow } from "./runtime.js";
import { InteractionPolicyCapability } from "../../capabilities/interaction_policy/api.js";
import type { StelleEventBus } from "../../core/event/event_bus.js";

export const internalInteractionPackage: ComponentPackage = {
  id: "window.internal_interaction",
  kind: "window",
  version: "1.0.0",
  displayName: "Internal Interaction Window",

  provides: [
    { id: "window.internal_interaction", kind: "service" },
  ],

  register(ctx: ComponentRegisterContext) {
    const eventBus = ctx.registry.resolve<StelleEventBus>("core.event_bus");
    const interactionPolicy = new InteractionPolicyCapability();

    const window = new InternalInteractionWindow({
      eventBus: eventBus!,
      interactionPolicy,
    });

    ctx.registry.provide("window.internal_interaction", window);
  },

  async start(ctx: ComponentRuntimeContext) {},
  async stop(ctx: ComponentRuntimeContext) {},
};
