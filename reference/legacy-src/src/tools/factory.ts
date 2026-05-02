import { createConfiguredTtsProvider } from "../utils/tts.js";
import { ToolRegistry } from "./registry.js";
import {
  createCoreTools,
  createDiscordTools,
  createLiveTools,
  createMemoryTools,
  createSceneTools,
  createSearchTools,
  createTtsTools,
  type ToolRegistryDeps,
} from "./providers/default_tools.js";

export type { ToolRegistryDeps } from "./providers/default_tools.js";

export function createDefaultToolRegistry(deps: ToolRegistryDeps = {}): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of [
    ...createCoreTools(),
    ...createDiscordTools(deps),
    ...createSearchTools(),
    ...createMemoryTools(deps),
    ...createLiveTools(deps),
    ...createSceneTools(deps),
    ...createTtsTools(deps.tts ?? createConfiguredTtsProvider()),
  ]) {
    registry.register(tool);
  }
  return registry;
}
