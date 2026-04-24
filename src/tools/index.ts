import { CursorRegistry } from "../core/CursorRegistry.js";
import { createMemoryTools } from "./memory.js";
import { registerCoreTools } from "./core.js";
import { createDiscordCursorTools } from "./discord.js";
import { createLiveCursorTools } from "./live.js";
import { createSearchTools } from "./search.js";
import { createTtsTools } from "./tts.js";
import { ToolRegistry } from "./ToolRegistry.js";

export function createDefaultToolRegistry(cursors?: CursorRegistry): ToolRegistry {
  const registry = new ToolRegistry();
  registerCoreTools(registry);

  const toolGroups = [
    createMemoryTools(),
    createSearchTools(),
    createTtsTools(),
    ...(cursors ? [createDiscordCursorTools(cursors), createLiveCursorTools(cursors)] : []),
  ];

  for (const group of toolGroups) {
    for (const tool of group) {
      registry.register(tool);
    }
  }
  return registry;
}
