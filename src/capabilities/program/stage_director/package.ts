import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../../core/protocol/component.js";
import { LiveStageDirector } from "./stage_director.js";
import { createStageDirectorDebugProvider } from "./debug_provider.js";
import type { RuntimeConfig } from "../../../config/index.js";
import type { StageOutputArbiter } from "../../expression/stage_output/arbiter.js";

export const stageDirectorCapability: ComponentPackage = {
  id: "capability.program.stage_director",
  kind: "capability",
  version: "1.0.0",
  displayName: "Stage Director",

  requires: [{ id: "capability.expression.stage_output" }],

  provides: [
    { id: "program.stage_director", kind: "service" },
    { id: "program.stage_director.debug", kind: "debug_provider" },
  ],

  register(ctx: ComponentRegisterContext) {
    const config = ctx.config as any as RuntimeConfig;
    const stageOutput = ctx.registry.resolve<StageOutputArbiter>("expression.stage_output");

    const director = new LiveStageDirector({
      config,
      eventBus: ctx.events as never,
      stageOutput: stageOutput!,
      now: () => Date.now(),
    });

    ctx.registry.provideForPackage?.(stageDirectorCapability.id, "program.stage_director", director) ??
      ctx.registry.provide("program.stage_director", director);
    ctx.registry.provideDebugProvider(createStageDirectorDebugProvider(director));
  },

  async start(ctx: ComponentRuntimeContext) {
    const director = ctx.registry.resolve<LiveStageDirector>("program.stage_director");
    if (director) {
      director.start();
    }
  },

  async stop(ctx: ComponentRuntimeContext) {
    const director = ctx.registry.resolve<LiveStageDirector>("program.stage_director");
    if (director) {
      await director.stop();
    }
  },
};
