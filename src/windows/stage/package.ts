import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../core/protocol/component.js";
import type { RuntimeConfig } from "../../config/index.js";
import type { DebugServer } from "../../debug/server/debug_server.js";
import { LiveRuntime } from "../../utils/live.js";
import { StageWindow } from "./stage_window.js";
import { createStageWindowDebugProvider } from "./debug_provider.js";

export const stageWindowPackage: ComponentPackage = {
  id: "window.stage",
  kind: "window",
  version: "1.0.0",
  displayName: "Stage Window",

  provides: [
    { id: "window.stage", kind: "service" },
    { id: "window.stage.debug", kind: "debug_provider" },
  ],

  register(ctx: ComponentRegisterContext) {
    const live = ctx.registry.resolve<LiveRuntime>("platform.live_runtime");
    if (!live) throw new Error("platform.live_runtime is required before loading window.stage");
    const debugServer = ctx.registry.resolve<DebugServer>("runtime.debug_server");
    const window = new StageWindow({
      config: ctx.config as RuntimeConfig,
      live,
      logger: ctx.logger,
      getDebugSnapshot: () => debugServer?.getRuntimeSnapshot() as unknown as Record<string, unknown>,
    });
    ctx.registry.provideForPackage?.(stageWindowPackage.id, "window.stage", window) ??
      ctx.registry.provide("window.stage", window);
    ctx.registry.provideDebugProvider(createStageWindowDebugProvider(window));
  },

  async start(ctx: ComponentRuntimeContext) {
    await ctx.registry.resolve<StageWindow>("window.stage")?.start();
  },

  async stop(ctx: ComponentRuntimeContext) {
    await ctx.registry.resolve<StageWindow>("window.stage")?.stop();
  },
};
