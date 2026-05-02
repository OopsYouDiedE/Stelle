import type { ComponentPackage, ComponentRegisterContext } from "../../core/protocol/component.js";
import { createDefaultToolRegistry } from "../../tool.js";
import type { ToolRegistryDeps } from "../../tools/providers/default_tools.js";

export const toolingCapability: ComponentPackage = {
  id: "capability.tooling",
  kind: "capability",
  version: "1.0.0",
  displayName: "Tooling",

  provides: [{ id: "tools.registry", kind: "service" }],

  register(ctx: ComponentRegisterContext) {
    const deps = ctx.registry.resolve<ToolRegistryDeps>("tools.bootstrap_deps") ?? {};
    const registry = createDefaultToolRegistry(deps);
    ctx.registry.provideForPackage?.(toolingCapability.id, "tools.registry", registry) ??
      ctx.registry.provide("tools.registry", registry);
  },
};
