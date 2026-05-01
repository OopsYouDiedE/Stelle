import type { DiscordRuntime } from "../../utils/discord.js";
import type { LiveRuntime } from "../../utils/live.js";
import type { MemoryStore } from "../../memory/memory.js";
import type { StreamingTtsProvider } from "../../utils/tts.js";
import type { SceneObserver } from "../../scene/observer.js";
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
