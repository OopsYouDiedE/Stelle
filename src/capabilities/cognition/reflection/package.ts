import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../../core/protocol/component.js";
import { ReflectionEngine } from "./reflection_engine.js";
import { createReflectionDebugProvider } from "./debug_provider.js";
import type { MemoryStore } from "../../memory/store/memory_store.js";

export const reflectionCapability: ComponentPackage = {
  id: "capability.cognition.reflection",
  kind: "capability",
  version: "1.0.0",
  displayName: "Reflection Engine",

  requires: [{ id: "capability.memory.store" }],

  provides: [
    { id: "cognition.reflection", kind: "service" },
    { id: "cognition.reflection.debug", kind: "debug_provider" },
  ],

  register(ctx: ComponentRegisterContext) {
    const memory = ctx.registry.resolve<MemoryStore>("memory.store");
    const engine = new ReflectionEngine(memory);
    ctx.registry.provide("cognition.reflection", engine);
    ctx.registry.provideDebugProvider(createReflectionDebugProvider(engine));
  },

  async start(ctx: ComponentRuntimeContext) {
    ctx.registry.resolve<ReflectionEngine>("cognition.reflection")?.observeSignal();
  },
};
