import type { ComponentPackage, ComponentRegisterContext } from "../../../core/protocol/component.js";
import { createConfiguredTtsProvider } from "./tts_provider.js";
import { createTtsTools } from "./tools.js";

export const speechOutputPackage: ComponentPackage = {
  id: "capability.expression.speech_output",
  kind: "capability",
  version: "1.0.0",
  displayName: "Speech Output",

  provides: [{ id: "expression.speech_output", kind: "service" }],

  register(ctx: ComponentRegisterContext) {
    const ttsProvider = ctx.registry.resolve<any>("expression.speech_output") ?? createConfiguredTtsProvider();
    
    ctx.registry.provideForPackage?.(speechOutputPackage.id, "expression.speech_output", ttsProvider) ??
      ctx.registry.provide("expression.speech_output", ttsProvider);

    const toolRegistry = ctx.registry.resolve<any>("tools.registry");
    if (toolRegistry) {
      for (const tool of createTtsTools(ttsProvider)) toolRegistry.register(tool);
    }
  },
};