import { CursorRegistry } from "../core/CursorRegistry.js";
import { echoTool } from "./basic.js";
import { createBrowserCompatibilityTools } from "./browser.js";
import { registerCoreTools } from "./core.js";
import { createDiscordCursorTools } from "./discord.js";
import { createLiveCursorTools } from "./live.js";
import { createSearchTools } from "./search.js";
import { createTtsTools } from "./tts.js";
import { ToolRegistry } from "./ToolRegistry.js";

export function createDefaultToolRegistry(cursors?: CursorRegistry): ToolRegistry {
  const registry = new ToolRegistry();
  registerCoreTools(registry);
  registry.register(echoTool);
  for (const tool of createSearchTools()) {
    registry.register(tool);
  }
  for (const tool of createBrowserCompatibilityTools()) {
    registry.register(tool);
  }
  for (const tool of createTtsTools()) {
    registry.register(tool);
  }
  if (cursors) {
    for (const tool of createDiscordCursorTools(cursors)) {
      registry.register(tool);
    }
    for (const tool of createLiveCursorTools(cursors)) {
      registry.register(tool);
    }
  }
  return registry;
}
