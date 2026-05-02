import type { DiscordRuntime } from "../../utils/discord.js";
import type { LiveRuntime } from "../../utils/live.js";
import type { MemoryStore } from "../../capabilities/memory/store/memory_store.js";
import type { StreamingTtsProvider } from "../../utils/tts.js";
import type { SceneObserver } from "../../capabilities/perception/scene_observation/renderer_scene_observer.js";
import type { StelleEventBus } from "../../utils/event_bus.js";

export interface ToolRegistryDeps {
  cwd?: string;
  discord?: DiscordRuntime;
  live?: LiveRuntime;
  memory?: MemoryStore;
  tts?: StreamingTtsProvider;
  sceneObserver?: SceneObserver;
  eventBus?: StelleEventBus;
}
