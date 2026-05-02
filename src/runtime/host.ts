import path from "node:path";
import { loadRuntimeConfig, type RuntimeConfig } from "../config/index.js";
import { ComponentLoader } from "../core/runtime/component_loader.js";
import { ComponentRegistry } from "../core/runtime/component_registry.js";
import { DataPlane } from "../core/runtime/data_plane.js";
import type { ComponentPackage } from "../core/protocol/component.js";
import { DebugSecurityPolicy } from "../debug/server/debug_auth.js";
import { DebugServer } from "../debug/server/debug_server.js";
import { StelleEventBus } from "../utils/event_bus.js";
import { DiscordRuntime } from "../utils/discord.js";
import { LiveRuntime, ObsWebSocketController } from "../utils/live.js";
import { LlmClient } from "../capabilities/model/llm.js";
import { MemoryStore } from "../capabilities/memory/store/memory_store.js";
import { SceneObserver } from "../capabilities/perception/scene_observation/renderer_scene_observer.js";
import { createDefaultToolRegistry, type ToolRegistry } from "../tool.js";
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

export type StartMode = "runtime" | "discord" | "live";

export interface RuntimeHostSnapshot {
  mode: StartMode;
  packages: string[];
  activePackages: string[];
  debug: ReturnType<DebugServer["getRuntimeSnapshot"]>;
}

export class RuntimeHost {
  readonly config: RuntimeConfig;
  readonly registry = new ComponentRegistry();
  readonly events = new StelleEventBus();
  readonly dataPlane = new DataPlane();
  readonly debugPolicy: DebugSecurityPolicy;
  readonly debugServer: DebugServer;
  readonly loader: ComponentLoader;
  readonly discord = new DiscordRuntime();
  readonly live: LiveRuntime;
  readonly llm: LlmClient;
  readonly memory: MemoryStore;
  readonly sceneObserver: SceneObserver;
  readonly tools: ToolRegistry;
  private started = false;
  private loadedPackageIds: string[] = [];

  constructor(readonly mode: StartMode = "runtime") {
    this.config = loadRuntimeConfig();
    this.live = new LiveRuntime(
      new ObsWebSocketController({ enabled: this.config.live.obsControlEnabled }),
      undefined,
      this.events,
    );
    this.llm = new LlmClient(this.config.models);
    this.memory = new MemoryStore({
      rootDir: path.join(process.cwd(), "memory"),
      recentLimit: 50,
      llm: this.llm,
    });
    this.sceneObserver = new SceneObserver(this.config.sceneObservation);
    this.tools = createDefaultToolRegistry({
      discord: this.discord,
      live: this.live,
      memory: this.memory,
      cwd: process.cwd(),
      sceneObserver: this.sceneObserver,
      eventBus: this.events,
    });

    this.debugPolicy = new DebugSecurityPolicy({
      allowRemote: this.config.debug.enabled,
      localOnly: !this.config.debug.enabled,
      trustedTokens: this.config.debug.token ? [this.config.debug.token] : [],
      operatorMode: this.config.debug.allowExternalWrite,
      allowExternalEffect: this.config.debug.allowExternalWrite,
    });
    this.debugServer = new DebugServer(this.registry, this.debugPolicy, {
      securityMode: this.config.debug.enabled ? "remote-token" : "local-only",
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
    const packages = this.selectPackages();
    for (const pkg of packages) {
      await this.loader.load(pkg);
      this.loadedPackageIds.push(pkg.id);
    }
    for (const pkg of packages) {
      await this.loader.start(pkg.id);
    }
    this.started = true;
    console.log(`[Stelle] RuntimeHost started in ${this.mode} mode.`);
  }

  async stop(): Promise<void> {
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
    this.registry.provide("platform.discord", this.discord);
    this.registry.provide("platform.live_runtime", this.live);
    this.registry.provide("memory.store", this.memory);
    this.registry.provide("model.llm", this.llm);
    this.registry.provide("tools.registry", this.tools);
    this.registry.provide("perception.scene_renderer_observer", this.sceneObserver);
  }

  private selectPackages(): ComponentPackage[] {
    const packages: ComponentPackage[] = [
      memoryStoreCapability,
      viewerProfileCapability,
      runtimeKernelCapability,
      browserControlCapability,
      desktopInputCapability,
      androidDeviceCapability,
      deviceActionCapability,
      sceneObservationPackage,
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
      packages.push(stageOutputCapability);
    }
    if ((this.mode === "runtime" || this.mode === "discord") && this.config.discord.enabled) {
      packages.push(discordWindowPackage);
    }
    if (this.mode === "runtime" && this.config.browser.enabled) {
      packages.push(browserWindowPackage);
    }
    if (this.mode === "runtime" && this.config.desktopInput.enabled) {
      packages.push(desktopInputWindowPackage);
    }

    return packages;
  }
}
