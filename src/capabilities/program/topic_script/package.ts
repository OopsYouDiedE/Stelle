import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../../core/protocol/component.js";
import { TopicScriptRuntimeService } from "./runtime.js";
import { createTopicScriptDebugProvider } from "./debug_provider.js";
import type { StageOutputArbiter } from "../../expression/stage_output/arbiter.js";

export const topicScriptCapability: ComponentPackage = {
  id: "capability.program.topic_script",
  kind: "capability",
  version: "1.0.0",
  displayName: "Topic Script",

  requires: [{ id: "capability.expression.stage_output" }],

  provides: [
    { id: "program.topic_script", kind: "service" },
    { id: "program.topic_script.debug", kind: "debug_provider" },
  ],

  register(ctx: ComponentRegisterContext) {
    const stageOutput = ctx.registry.resolve<StageOutputArbiter>("expression.stage_output");

    const service = new TopicScriptRuntimeService({
      eventBus: ctx.events as never,
      stageOutput: stageOutput!,
      now: () => Date.now(),
    });

    ctx.registry.provideForPackage?.(topicScriptCapability.id, "program.topic_script", service) ??
      ctx.registry.provide("program.topic_script", service);
    ctx.registry.provideDebugProvider(createTopicScriptDebugProvider(service));
  },

  async start(ctx: ComponentRuntimeContext) {
    const service = ctx.registry.resolve<TopicScriptRuntimeService>("program.topic_script");
    if (service) {
      await service.start();
    }
  },

  async stop(ctx: ComponentRuntimeContext) {
    const service = ctx.registry.resolve<TopicScriptRuntimeService>("program.topic_script");
    if (service) {
      await service.stop();
    }
  },
};
