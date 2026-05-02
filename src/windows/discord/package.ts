import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../core/protocol/component.js";
import { DiscordRuntime } from "../../utils/discord.js";
import type { RuntimeConfig } from "../../config/index.js";
import { DiscordWindow } from "./discord_window.js";
import { createDiscordWindowDebugProvider } from "./debug_provider.js";

export const discordWindowPackage: ComponentPackage = {
  id: "window.discord",
  kind: "window",
  version: "1.0.0",
  displayName: "Discord Window",

  provides: [
    { id: "window.discord", kind: "service" },
    { id: "window.discord.debug", kind: "debug_provider" },
  ],

  register(ctx: ComponentRegisterContext) {
    const discord = ctx.registry.resolve<DiscordRuntime>("platform.discord") ?? new DiscordRuntime();
    const window = new DiscordWindow({
      config: ctx.config as RuntimeConfig,
      discord,
      events: ctx.events as never,
      logger: ctx.logger,
    });
    ctx.registry.provideForPackage?.(discordWindowPackage.id, "window.discord", window) ??
      ctx.registry.provide("window.discord", window);
    ctx.registry.provideDebugProvider(createDiscordWindowDebugProvider(window));
  },

  async start(ctx: ComponentRuntimeContext) {
    await ctx.registry.resolve<DiscordWindow>("window.discord")?.start();
  },

  async stop(ctx: ComponentRuntimeContext) {
    await ctx.registry.resolve<DiscordWindow>("window.discord")?.stop();
  },
};
