import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../../core/protocol/component.js";
import { TopicScriptRuntimeService } from "./runtime.js";
import { createTopicScriptDebugProvider } from "./debug_provider.js";

export const topicScriptCapability: ComponentPackage = {
  id: "capability.program.topic_script",
  kind: "capability",
  version: "1.0.0",
  displayName: "Topic Script",

  provides: [
    { id: "program.topic_script", kind: "service" },
    { id: "program.topic_script.debug", kind: "debug_provider" },
  ],

  register(ctx: ComponentRegisterContext) {
    const service = new TopicScriptRuntimeService({
      eventBus: ctx.events as never,
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
