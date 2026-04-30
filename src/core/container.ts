import path from "node:path";
import { type RuntimeConfig } from "../utils/config_loader.js";
import { LlmClient } from "../utils/llm.js";
import { LiveRuntime, ObsWebSocketController, LocalLiveRendererBridge } from "../utils/live.js";
import { DiscordRuntime } from "../utils/discord.js";
import { MemoryStore } from "../utils/memory.js";
import { createDefaultToolRegistry, type ToolRegistry } from "../tool.js";
import { RuntimeState } from "../runtime_state.js";
import { StelleEventBus } from "../utils/event_bus.js";
import { StageOutputArbiter } from "../stage/output_arbiter.js";
import { StageOutputRenderer } from "../stage/output_renderer.js";
import { DeviceActionArbiter } from "../device/action_arbiter.js";
import { AndroidAdbDriver } from "../device/drivers/android_adb_driver.js";
import { BrowserCdpDriver } from "../device/drivers/browser_cdp_driver.js";
import { DesktopInputDriver } from "../device/drivers/desktop_input_driver.js";
import { buildDeviceActionAllowlist } from "../device/action_allowlist.js";
import { LiveRendererServer } from "../utils/renderer.js";
import type { CursorContext } from "../cursor/types.js";
import { ViewerProfileStore } from "../live/ops/viewer_profile.js";
import { SceneObserver } from "../scene/observer.js";

export interface RuntimeServices {
  config: RuntimeConfig;
  state: RuntimeState;
  llm: LlmClient;
  memory: MemoryStore;
  discord: DiscordRuntime;
  eventBus: StelleEventBus;
  live: LiveRuntime;
  tools: ToolRegistry;
  stageOutput: StageOutputArbiter;
  deviceAction: DeviceActionArbiter;
  viewerProfiles: ViewerProfileStore;
  sceneObserver: SceneObserver;
}

export class StelleContainer {
  public static createServices(config: RuntimeConfig, renderer?: LiveRendererServer): RuntimeServices {
    const state = new RuntimeState();
    const llm = new LlmClient(config.models);
    const eventBus = new StelleEventBus();
    const viewerProfiles = new ViewerProfileStore(path.join(process.cwd(), "memory", "live", "viewers"));
    const sceneObserver = new SceneObserver(config.sceneObservation, renderer);
    const memory = new MemoryStore({
      rootDir: path.join(process.cwd(), "memory"),
      recentLimit: 50,
      llm: llm,
    });
    const discord = new DiscordRuntime();
    
    const live = new LiveRuntime(
      new ObsWebSocketController({ enabled: config.live.obsControlEnabled }),
      renderer ? new LocalLiveRendererBridge(renderer) : undefined,
      eventBus,
    );
    
    const tools = createDefaultToolRegistry({ discord, live, memory, cwd: process.cwd(), sceneObserver, eventBus });
    
    const stageOutput = new StageOutputArbiter({
      renderer: new StageOutputRenderer({
        tools,
        cwd: process.cwd(),
        ttsEnabled: Boolean(config.live.ttsEnabled),
      }),
      eventBus,
      now: () => Date.now(),
      debugEnabled: Boolean(config.debug.enabled),
      maxQueueLength: config.live.speechQueueLimit || 5,
    });

    const deviceAction = new DeviceActionArbiter({
      drivers: [new BrowserCdpDriver(), new DesktopInputDriver(), new AndroidAdbDriver()],
      eventBus,
      now: () => Date.now(),
      allowlist: buildDeviceActionAllowlist(config),
    });

    return {
      config,
      state,
      llm,
      memory,
      discord,
      eventBus,
      live,
      tools,
      stageOutput,
      deviceAction,
      viewerProfiles,
      sceneObserver,
    };
  }

  public static createCursorContext(services: RuntimeServices): CursorContext {
    return {
      llm: services.llm,
      tools: services.tools,
      config: services.config,
      memory: services.memory,
      eventBus: services.eventBus,
      stageOutput: services.stageOutput,
      deviceAction: services.deviceAction,
      viewerProfiles: services.viewerProfiles,
      now: () => Date.now(),
    };
  }
}
