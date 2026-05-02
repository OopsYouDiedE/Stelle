import { createLiveTools } from "./tools.js";
import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../core/protocol/component.js";
import { LiveWindow } from "./live_window.js";
import { createLiveWindowDebugProvider } from "./debug_provider.js";

export const liveWindowPackage: ComponentPackage = {
  id: "window.live",
  kind: "window",
  version: "1.0.0",
  displayName: "Live Window",

  provides: [
    { id: "window.live", kind: "service" },
    { id: "window.live.debug", kind: "debug_provider" },
  ],

  register(ctx: ComponentRegisterContext) {
    const liveWindow = new LiveWindow({
      eventBus: ctx.events as never,
      config: ctx.config as any,
      logger: ctx.logger,
    });

    ctx.registry.provideForPackage?.(liveWindowPackage.id, "window.live", liveWindow) ??
      ctx.registry.provide("window.live", liveWindow);
    ctx.registry.provideDebugProvider(createLiveWindowDebugProvider(liveWindow));
    const toolRegistry = ctx.registry.resolve<any>("tools.registry");
    const live = ctx.registry.resolve<any>("platform.live_runtime");
    if (toolRegistry && live) {
      for (const tool of createLiveTools({ live })) toolRegistry.register(tool);
    }
  },

  async start(ctx: ComponentRuntimeContext) {
    const liveWindow = ctx.registry.resolve<LiveWindow>("window.live");
    if (liveWindow) {
      await liveWindow.start();
    }
  },

  async stop(ctx: ComponentRuntimeContext) {
    const liveWindow = ctx.registry.resolve<LiveWindow>("window.live");
    if (liveWindow) {
      await liveWindow.stop();
    }
  },
};
