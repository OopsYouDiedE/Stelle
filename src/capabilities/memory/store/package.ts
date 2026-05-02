import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../../core/protocol/component.js";
import { MemoryStore } from "./memory_store.js";
import { createMemoryStoreDebugProvider } from "./debug_provider.js";

export const memoryStoreCapability: ComponentPackage = {
  id: "capability.memory.store",
  kind: "capability",
  version: "1.0.0",
  displayName: "Memory Store",

  provides: [
    { id: "memory.store", kind: "service" },
    { id: "memory.store.debug", kind: "debug_provider" },
  ],

  async register(ctx: ComponentRegisterContext) {
    const existing = ctx.registry.resolve<MemoryStore>("memory.store");
    const store =
      existing ??
      new MemoryStore({
        rootDir: "memory",
      });

    await store.start();
    ctx.registry.provideForPackage?.(memoryStoreCapability.id, "memory.store", store) ??
      ctx.registry.provide("memory.store", store);
    ctx.registry.provideDebugProvider(createMemoryStoreDebugProvider(store));
  },
};
