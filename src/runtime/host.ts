import { speechOutputPackage } from "../capabilities/expression/speech_output/package.js";
import path from "node:path";
import { loadYamlConfig } from "../core/config/index.js";
import { loadDiscordConfig } from "../windows/discord/config.js";
import { loadBrowserConfig } from "../capabilities/action/browser_control/config.js";
import { loadDesktopInputConfig } from "../capabilities/action/desktop_input/config.js";
import { loadModelConfig } from "../capabilities/model/config.js";
import { loadLiveConfig } from "../windows/live/config.js";
import { loadSceneObservationConfig } from "../capabilities/perception/scene_observation/config.js";
import { loadDebugConfig } from "../debug/config.js";
import { ComponentLoader } from "../core/runtime/component_loader.js";
import { ComponentRegistry } from "../core/runtime/component_registry.js";
import { DataPlane } from "../core/runtime/data_plane.js";
import { VersionedStore } from "../core/state/versioned_store.js";
import type { ComponentPackage } from "../core/protocol/component.js";
import { DebugSecurityPolicy } from "../debug/server/debug_auth.js";
import { DebugServer } from "../debug/server/debug_server.js";
import { StelleEventBus } from "../core/event/event_bus.js";
import { DiscordRuntime } from "../windows/discord/runtime.js";
import { LiveRuntime, ObsWebSocketController } from "../windows/stage/bridge/live_runtime.js";
import { LlmClient } from "../capabilities/model/llm.js";
import { MemoryStore } from "../capabilities/memory/store/memory_store.js";
import { SceneObserver } from "../capabilities/perception/scene_observation/renderer_scene_observer.js";
import { toolingCapability } from "../capabilities/tooling/package.js";
import { memoryStoreCapability } from "../capabilities/memory/store/package.js";
import { viewerProfileCapability } from "../capabilities/memory/viewer_profile/package.js";
import { runtimeKernelCapability } from "../capabilities/cognition/runtime_kernel/package.js";
import { stageOutputCapability } from "../capabilities/expression/stage_output/package.js";
import { deviceActionCapability } from "../capabilities/action/device_action/package.js";
import { browserControlCapability } from "../capabilities/action/browser_control/package.js";
import { desktopInputCapability } from "../capabilities/action/desktop_input/package.js";
import { androidDeviceCapability } from "../capabilities/action/android_device/package.js";
import { sceneObservationPackage } from "../capabilities/perception/scene_observation/package.js";
import { stageDirectorCapability } from "../capabilities/program/stage_director/package.js";
import { topicScriptCapability } from "../capabilities/program/topic_script/package.js";
import { liveWindowPackage } from "../windows/live/package.js";
import { discordWindowPackage } from "../windows/discord/package.js";
import { stageWindowPackage } from "../windows/stage/package.js";
import { browserWindowPackage } from "../windows/browser/package.js";
import { desktopInputWindowPackage } from "../windows/desktop_input/package.js";
import { internalCognitionPackage } from "../windows/internal_cognition/package.js";
import { internalInteractionPackage } from "../windows/internal_interaction/package.js";
import { internalMemoryPackage } from "../windows/internal_memory/package.js";
import { internalWorldPackage } from "../windows/internal_world/package.js";
import { PluginRegistry } from "../debug/plugin_registry.js";

export type StartMode = "runtime" | "discord" | "live";

export interface RuntimeHostSnapshot {
  mode: StartMode;
  packages: string[];
  activePackages: string[];
  debug: ReturnType<DebugServer["getRuntimeSnapshot"]>;
}

export class RuntimeHost {
  readonly config: any;
  readonly registry = new ComponentRegistry();
  readonly events = new StelleEventBus();
  readonly dataPlane = new DataPlane();
  readonly versionedStore = new VersionedStore();
  readonly debugPolicy: DebugSecurityPolicy;
  readonly debugServer: DebugServer;
  readonly loader: ComponentLoader;
  readonly discord = new DiscordRuntime();
  readonly live: LiveRuntime;
  readonly llm: LlmClient;
  readonly memory: MemoryStore;
  readonly sceneObserver: SceneObserver;
  readonly pluginRegistry = new PluginRegistry();

  private started = false;
  private loadedPackageIds: string[] = [];

  constructor(readonly mode: StartMode = "runtime") {
    const rawYaml = loadYamlConfig();
    const debugConfig = loadDebugConfig(rawYaml);
    this.config = { rawYaml } as any;
    this.live = new LiveRuntime(
      new ObsWebSocketController({ enabled: loadLiveConfig(rawYaml).obsControlEnabled }),
      undefined,
      this.events,
    );
    this.llm = new LlmClient(loadModelConfig(rawYaml));
    this.memory = new MemoryStore({
      rootDir: path.join(process.cwd(), "memory"),
      recentLimit: 50,
      llm: this.llm,
    });
    this.sceneObserver = new SceneObserver(loadSceneObservationConfig(rawYaml));

    this.debugPolicy = new DebugSecurityPolicy({
      allowRemote: debugConfig.enabled,
      localOnly: !debugConfig.enabled,
      trustedTokens: debugConfig.token ? [debugConfig.token] : [],
      operatorMode: debugConfig.allowExternalWrite,
      allowExternalEffect: debugConfig.allowExternalWrite,
    });
    this.debugServer = new DebugServer(this.registry, this.debugPolicy, {
      securityMode: debugConfig.enabled ? "remote-token" : "local-only",
      listResourceRefs: () => this.dataPlane.listResourceRefs(),
      listStreamRefs: () => this.dataPlane.listStreamRefs(),
      listBackpressureStatus: () => [this.events.getBackpressureStatus()],
    });
    this.loader = new ComponentLoader({
      registry: this.registry,
      events: this.events,
      dataPlane: this.dataPlane,
      config: this.config as never,
      logger: console,
      security: {},
      clock: { now: () => Date.now() },
    });

    this.provideBootstrapServices();
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.memory.start();

    // Setup PluginController for Hot-Swap
    this.debugServer.setPluginController({
      load: async (id) => {
        const pkg = this.pluginRegistry.get(id);
        if (!pkg) throw new Error(`Package ${id} not found in registry`);
        this.debugServer.broadcastPackageEvent("load_start", id);
        try {
          await this.loader.load(pkg);
          if (!this.loadedPackageIds.includes(pkg.id)) {
            this.loadedPackageIds.push(pkg.id);
          }
        } finally {
          this.debugServer.broadcastPackageEvent("load_end", id);
        }
      },
      start: async (id) => {
        this.debugServer.broadcastPackageEvent("start_start", id);
        try {
          await this.loader.start(id);
        } finally {
          this.debugServer.broadcastPackageEvent("start_end", id);
        }
      },
      stop: async (id) => {
        this.debugServer.broadcastPackageEvent("stop_start", id);
        try {
          await this.loader.stop(id);
        } finally {
          this.debugServer.broadcastPackageEvent("stop_end", id);
        }
      },
      unload: async (id) => {
        this.debugServer.broadcastPackageEvent("unload_start", id);
        try {
          await this.loader.unload(id);
          this.loadedPackageIds = this.loadedPackageIds.filter((pid) => pid !== id);
        } finally {
          this.debugServer.broadcastPackageEvent("unload_end", id);
        }
      },
      listAvailable: () => this.pluginRegistry.list(),
    });

    const debugConfig = loadDebugConfig(this.config.rawYaml);
    const debugUrl = await this.debugServer.startHttpServer(debugConfig.port);
    console.log(`[Stelle] Phase 1 Boot Complete. Debug UI available at ${debugUrl}`);

    // Phase 2 Async Load
    this.startPlugins().catch((err) => {
      console.error("[Stelle] Failed during Phase 2 async boot:", err);
    });

    this.started = true;
    console.log(`[Stelle] RuntimeHost started in ${this.mode} mode.`);
  }

  private async startPlugins(): Promise<void> {
    const packages = this.selectPackages();
    // Register all selected packages to PluginRegistry
    for (const pkg of packages) {
      if (!this.pluginRegistry.get(pkg.id)) {
        this.pluginRegistry.register(pkg);
      }
    }

    // Load sequentially
    for (const pkg of packages) {
      this.debugServer.broadcastPackageEvent("load_start", pkg.id);
      await this.loader.load(pkg);
      this.loadedPackageIds.push(pkg.id);
      this.debugServer.broadcastPackageEvent("load_end", pkg.id);
    }

    // Start sequentially
    for (const pkg of packages) {
      this.debugServer.broadcastPackageEvent("start_start", pkg.id);
      await this.loader.start(pkg.id);
      this.debugServer.broadcastPackageEvent("start_end", pkg.id);
    }
    console.log(`[Stelle] Phase 2 Boot Complete. All plugins started.`);
  }

  async stop(): Promise<void> {
    await this.debugServer.stopHttpServer();
    for (const packageId of [...this.loadedPackageIds].reverse()) {
      await this.loader.stop(packageId).catch((error) => {
        console.error(`[Stelle] Failed to stop ${packageId}:`, error);
      });
    }
    await this.discord.destroy();
    this.started = false;
    console.log("[Stelle] RuntimeHost stopped.");
  }

  snapshot(): RuntimeHostSnapshot {
    return {
      mode: this.mode,
      packages: this.registry.listPackages().map((pkg) => pkg.id),
      activePackages: this.registry.listActivePackageIds(),
      debug: this.debugServer.getRuntimeSnapshot(),
    };
  }

  private provideBootstrapServices(): void {
    this.registry.provide("runtime.config", this.config);
    this.registry.provide("runtime.debug_server", this.debugServer);
    this.registry.provide("core.event_bus", this.events);
    this.registry.provide("core.versioned_store", this.versionedStore);
    this.registry.provide("platform.discord", this.discord);
    this.registry.provide("platform.live_runtime", this.live);
    this.registry.provide("memory.store", this.memory);
    this.registry.provide("model.llm", this.llm);
    this.registry.provide("tools.bootstrap_deps", {
      discord: this.discord,
      live: this.live,
      memory: this.memory,
      cwd: process.cwd(),
      sceneObserver: this.sceneObserver,
      eventBus: this.events,
    });
    this.registry.provide("perception.scene_renderer_observer", this.sceneObserver);
  }

  private selectPackages(): ComponentPackage[] {
    const packages: ComponentPackage[] = [
      memoryStoreCapability,
      toolingCapability,
      viewerProfileCapability,
      runtimeKernelCapability,
      browserControlCapability,
      desktopInputCapability,
      androidDeviceCapability,
      deviceActionCapability,
      sceneObservationPackage,
      internalCognitionPackage,
      internalInteractionPackage,
      internalMemoryPackage,
      internalWorldPackage,
    ];

    if (this.mode === "runtime" || this.mode === "live") {
      packages.push(
        stageWindowPackage,
        stageOutputCapability,
        liveWindowPackage,
        stageDirectorCapability,
        topicScriptCapability,
      );
    } else {
      packages.push(stageOutputCapability, speechOutputPackage);
    }
    if ((this.mode === "runtime" || this.mode === "discord") && loadDiscordConfig(this.config.rawYaml).enabled) {
      packages.push(discordWindowPackage);
    }
    if (this.mode === "runtime" && loadBrowserConfig(this.config.rawYaml).enabled) {
      packages.push(browserWindowPackage);
    }
    if (this.mode === "runtime" && loadDesktopInputConfig(this.config.rawYaml).enabled) {
      packages.push(desktopInputWindowPackage);
    }

    return packages;
  }
}
