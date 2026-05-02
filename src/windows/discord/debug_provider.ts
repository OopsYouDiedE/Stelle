import type { DebugProvider } from "../../core/protocol/debug.js";
import type { DiscordWindow } from "./discord_window.js";

export function createDiscordWindowDebugProvider(window: DiscordWindow): DebugProvider {
  return {
    id: "window.discord.debug",
    title: "Discord Window",
    ownerPackageId: "window.discord",
    panels: [{ id: "status", title: "Status", kind: "json", getData: () => window.snapshot() }],
    getSnapshot: () => window.snapshot(),
  };
}
