import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../../core/protocol/component.js";
import { StageDirector } from "./stage_director.js";
import { createStageDirectorDebugProvider } from "./debug_provider.js";

export const stageDirectorCapability: ComponentPackage = {
  id: "capability.program.stage_director",
  kind: "capability",
  version: "1.0.0",
  displayName: "Stage Director",

  provides: [
    { id: "program.stage_director", kind: "service" },
    { id: "program.stage_director.debug", kind: "debug_provider" },
  ],

  register(ctx: ComponentRegisterContext) {
    const config = ctx.config as any as any;

    const director = new StageDirector({
      config,
      eventBus: ctx.events as never,
      now: () => Date.now(),
    });

    ctx.registry.provideForPackage?.(stageDirectorCapability.id, "program.stage_director", director) ??
      ctx.registry.provide("program.stage_director", director);
    ctx.registry.provideDebugProvider(createStageDirectorDebugProvider(director));
  },

  async start(ctx: ComponentRuntimeContext) {
    const director = ctx.registry.resolve<StageDirector>("program.stage_director");
    if (director) {
      director.start();
    }
  },

  async stop(ctx: ComponentRuntimeContext) {
    const director = ctx.registry.resolve<StageDirector>("program.stage_director");
    if (director) {
      await director.stop();
    }
  },
};
