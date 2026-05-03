import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../core/protocol/component.js";
import { InternalMemoryWindow } from "./runtime.js";
import { SelfMemoryCapability } from "../../capabilities/self_memory/api.js";
import { ReflectionCapability } from "../../capabilities/reflection/api.js";
import type { StelleEventBus } from "../../core/event/event_bus.js";
import type { LlmClient } from "../../capabilities/model/llm.js";

export const internalMemoryPackage: ComponentPackage = {
  id: "window.internal_memory",
  kind: "window",
  version: "1.0.0",
  displayName: "Internal Memory Window",

  provides: [
    { id: "window.internal_memory", kind: "service" },
  ],

  register(ctx: ComponentRegisterContext) {
    const eventBus = ctx.registry.resolve<StelleEventBus>("core.event_bus");
    const llm = ctx.registry.resolve<LlmClient>("model.llm");
    const selfMemory = new SelfMemoryCapability();
    const reflection = new ReflectionCapability(llm!);

    const window = new InternalMemoryWindow({
      eventBus: eventBus!,
      selfMemory,
      reflection,
    });

    ctx.registry.provide("window.internal_memory", window);
    ctx.registry.provide("capabilities.reflection", reflection);
  },

  async start(ctx: ComponentRuntimeContext) {},
  async stop(ctx: ComponentRuntimeContext) {},
};
