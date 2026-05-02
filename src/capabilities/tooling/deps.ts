import type { DiscordRuntime } from "../../windows/discord/runtime.js";
import type { LiveRuntime } from "../../windows/stage/bridge/live_runtime.js";
import type { MemoryStore } from "../memory/store/memory_store.js";
import type { StreamingTtsProvider } from "../expression/speech_output/tts_provider.js";
import type { SceneObserver } from "../perception/scene_observation/renderer_scene_observer.js";
import type { StelleEventBus } from "../../core/event/event_bus.js";

export interface ToolRegistryDeps {
  cwd?: string;
  discord?: DiscordRuntime;
  live?: LiveRuntime;
  memory?: MemoryStore;
  tts?: StreamingTtsProvider;
  sceneObserver?: SceneObserver;
  eventBus?: StelleEventBus;
}
