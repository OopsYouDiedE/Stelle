import { ToolRegistry } from "../../src/capabilities/tooling/tool_registry.js";
import { createCoreTools } from "../../src/capabilities/tooling/core_tools.js";
import { createSearchTools } from "../../src/capabilities/tooling/search_tools.js";
import { createDiscordTools } from "../../src/windows/discord/tools.js";
import { createMemoryTools } from "../../src/capabilities/memory/store/tools.js";
import { createLiveTools } from "../../src/windows/live/tools.js";
import { createSceneTools } from "../../src/capabilities/perception/scene_observation/tools.js";
import { createTtsTools } from "../../src/capabilities/expression/speech_output/tools.js";
import { createConfiguredTtsProvider } from "../../src/capabilities/expression/speech_output/tts_provider.js";

export function createTestToolRegistry(deps: any = {}): ToolRegistry {
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
