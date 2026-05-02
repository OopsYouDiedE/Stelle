import type { ComponentPackage, ComponentRegisterContext } from "../../core/protocol/component.js";
import { ToolRegistry } from "./tool_registry.js";
import { createCoreTools } from "./core_tools.js";
import { createSearchTools } from "./search_tools.js";

export const toolingCapability: ComponentPackage = {
  id: "capability.tooling",
  kind: "capability",
  version: "1.0.0",
  displayName: "Tooling",

  provides: [{ id: "tools.registry", kind: "service" }],

  register(ctx: ComponentRegisterContext) {
    const registry = new ToolRegistry();
    
    // Core and search tools are native to the tooling capability
    const coreTools = createCoreTools();
    for (const tool of coreTools) {
      registry.register(tool);
    }
    const searchTools = createSearchTools();
    for (const tool of searchTools) {
      registry.register(tool);
    }

    ctx.registry.provideForPackage?.(toolingCapability.id, "tools.registry", registry) ??
      ctx.registry.provide("tools.registry", registry);
  },
};