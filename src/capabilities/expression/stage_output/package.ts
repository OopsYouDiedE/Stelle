import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../../core/protocol/component.js";
import { StageOutputArbiter } from "./arbiter.js";
import { StageOutputRenderer } from "./renderer.js";
import { createStageOutputDebugProvider } from "./debug_provider.js";
import type { ToolRegistry } from "../../../tool.js";
import type { RuntimeConfig } from "../../../config/index.js";

export const stageOutputCapability: ComponentPackage = {
  id: "capability.expression.stage_output",
  kind: "capability",
  version: "1.0.0",
  displayName: "Stage Output",

  provides: [
    { id: "expression.stage_output", kind: "service" },
    { id: "expression.stage_output.debug", kind: "debug_provider" },
  ],

  register(ctx: ComponentRegisterContext) {
    const toolRegistry = ctx.registry.resolve<ToolRegistry>("tools.registry");
    if (!toolRegistry) {
      throw new Error("tools.registry is required before loading Stage Output Capability.");
    }
    const config = ctx.config as RuntimeConfig;

    const renderer = new StageOutputRenderer({
      tools: toolRegistry,
      cwd: process.cwd(),
      ttsEnabled: Boolean(config.live?.ttsEnabled),
    });

    const arbiter = new StageOutputArbiter({
      renderer,
      eventBus: ctx.events as never,
      now: () => Date.now(),
      debugEnabled: Boolean(config.debug?.enabled),
      maxQueueLength: config.live?.speechQueueLimit || 5,
    });

    ctx.registry.provideForPackage?.(stageOutputCapability.id, "expression.stage_output", arbiter) ??
      ctx.registry.provide("expression.stage_output", arbiter);
    ctx.registry.provideDebugProvider(createStageOutputDebugProvider(arbiter));
  },

  async start(ctx: ComponentRuntimeContext) {
    ctx.logger.info("Stage Output Capability started");
  },

  async stop(ctx: ComponentRuntimeContext) {
    ctx.logger.info("Stage Output Capability stopped");
  },
};
