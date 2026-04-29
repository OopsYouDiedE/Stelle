import { loadRuntimeConfig, type RuntimeConfig } from "../utils/config_loader.js";
import { LiveRendererServer } from "../utils/renderer.js";
import { LiveRuntime } from "../utils/live.js";
import { DiscordRuntime } from "../utils/discord.js";
import { MemoryStore } from "../utils/memory.js";
import { type ToolRegistry } from "../tool.js";
import { RuntimeState } from "../runtime_state.js";
import type { StelleCursor } from "../cursor/types.js";
import { selectCursorModules } from "../cursor/registry.js";
import { StelleEventBus } from "../utils/event_bus.js";
import { StelleScheduler } from "./scheduler.js";
import { setupRendererControllers } from "./debug_controller.js";
import { StageOutputArbiter } from "../stage/output_arbiter.js";
import { DeviceActionArbiter } from "../device/action_arbiter.js";
import { StelleContainer, type RuntimeServices } from "./container.js";
import { LlmClient } from "../utils/llm.js";
import { LivePlatformManager } from "../live/platforms/manager.js";
import { LiveEngagementService } from "../live/engagement_service.js";

export type StartMode = "runtime" | "discord" | "live";

export class StelleApplication {
  private services: RuntimeServices;
  public readonly scheduler: StelleScheduler;
  public renderer?: LiveRendererServer;
  public cursors: StelleCursor[] = [];
  private livePlatforms?: LivePlatformManager;
  private liveEngagement?: LiveEngagementService;

  constructor(private readonly mode: StartMode) {
    const config = loadRuntimeConfig();
    this.services = StelleContainer.createServices(config);
    this.scheduler = new StelleScheduler({
      liveEnabled: mode === "runtime" || mode === "live",
      innerEnabled: true,
      innerTickMs: 45_000,
    });
  }

  // Getters for compatibility
  public get config(): RuntimeConfig { return this.services.config; }
  public get state(): RuntimeState { return this.services.state; }
  public get llm(): LlmClient { return this.services.llm; }
  public get memory(): MemoryStore { return this.services.memory; }
  public get discord(): DiscordRuntime { return this.services.discord; }
  public get eventBus(): StelleEventBus { return this.services.eventBus; }
  public get tools(): ToolRegistry { return this.services.tools; }
  public get stageOutput(): StageOutputArbiter { return this.services.stageOutput; }
  public get deviceAction(): DeviceActionArbiter { return this.services.deviceAction; }
  public get live(): LiveRuntime | undefined { return this.services.live; }

  public async start(): Promise<void> {
    if (this.mode === "discord" && !this.config.discord.token) {
      throw new Error("Missing DISCORD_TOKEN for discord start mode.");
    }

    await this.memory.start();

    if (this.mode === "runtime" || this.mode === "live") {
      await this.startRenderer();
    }

    await this.setupCursors();
    this.setupEventRouting();
    this.setupDebugController();
    await this.setupLiveServices();

    if (this.mode !== "live" && this.config.discord.token) {
      await this.connectDiscord();
    } else if (this.mode !== "live") {
      console.warn("[Stelle] DISCORD_TOKEN is not set; Discord runtime will not connect.");
    }

    this.scheduler.start();
    this.state.updateCursors(this.cursors.map(c => c.snapshot()));
    this.state.record("runtime_started", `Runtime started in ${this.mode} mode.`);
    console.log(`[Stelle] Runtime started in ${this.mode} mode.`);
  }

  private async startRenderer(): Promise<void> {
    this.renderer = new LiveRendererServer({
      host: this.config.live.rendererHost,
      port: this.config.live.rendererPort,
      debug: {
        enabled: this.config.debug.enabled,
        requireToken: this.config.debug.requireToken,
        token: this.config.debug.token,
      },
      control: {
        requireToken: this.config.control.requireToken,
        token: this.config.control.token,
      },
    });
    const url = await this.renderer.start();
    process.env.LIVE_RENDERER_URL = url;
    
    // Refresh services with renderer if needed
    this.services = StelleContainer.createServices(this.config, this.renderer);
    
    await this.services.live.start();
    this.state.updateRenderer({ connected: true });
    this.state.record("renderer_started", `Live renderer ready: ${url}/live`);
    console.log(`[Stelle] Live renderer ready: ${url}/live`);
  }

  private async connectDiscord(): Promise<void> {
    if (!this.config.discord.token) return;
    await this.discord.login(this.config.discord.token);
    const discordCursor = this.cursors.find(c => c.id === "discord_text_channel" || c.id === "discord");
    await this.discord.setBotPresence({ window: discordCursor?.id ?? "unknown", detail: "runtime" }).catch(() => undefined);
    const status = await this.discord.getStatus();
    this.state.updateDiscord({ connected: status.connected });
    this.state.record("discord_connected", `Discord connected=${status.connected} botUserId=${status.botUserId ?? "unknown"}`);
    console.log(`[Stelle] Discord connected=${status.connected} botUserId=${status.botUserId ?? "unknown"}`);
  }

  public async stop(): Promise<void> {
    this.scheduler.stop();
    await Promise.allSettled([
      ...this.cursors.map(c => c.stop?.()),
      this.livePlatforms?.stop(),
      this.discord.destroy(),
      this.renderer?.stop(),
    ]);
    this.liveEngagement?.stop();
    this.state.updateDiscord({ connected: false });
    this.state.updateRenderer({ connected: false });
    this.state.record("runtime_stopped", "Runtime stopped.");
  }

  private async setupCursors(): Promise<void> {
    const context = StelleContainer.createCursorContext(this.services);
    this.cursors = selectCursorModules({ mode: this.mode, config: this.config, liveAvailable: Boolean(this.live) })
      .map(module => module.create(context));

    await Promise.all(this.cursors.map(c => c.initialize?.()));

    this.discord.onMessage((message) => {
      this.eventBus.publish({
        type: "discord.text.message.received",
        source: "discord",
        payload: { message }
      });
    });
  }

  private setupEventRouting(): void {
    this.scheduler.onTick((type, reason) => {
      this.eventBus.publish({ type: type as any, source: "scheduler", reason });
    });

    this.eventBus.subscribe("cursor.reflection", (event) => {
      this.state.record("cursor_reflection", event.payload.summary, event.payload);
    });
  }

  private setupDebugController(): void {
    if (!this.renderer) return;

    setupRendererControllers({
      renderer: this.renderer,
      config: this.config,
      state: this.state,
      cursors: () => this.cursors,
      discord: this.discord,
      live: () => this.live,
      memory: this.memory,
      tools: this.tools,
      stageOutput: this.stageOutput,
      deviceAction: this.deviceAction,
      eventBus: this.eventBus,
      proposeSystemLiveOutput: (source, input) => this.proposeSystemLiveOutput(source, input),
      now: () => Date.now(),
    });
  }

  private async setupLiveServices(): Promise<void> {
    if (this.mode !== "runtime" && this.mode !== "live") return;

    this.liveEngagement = new LiveEngagementService({
      config: this.config,
      eventBus: this.eventBus,
      stageOutput: this.stageOutput,
      now: () => Date.now(),
    });
    this.liveEngagement.start();

    this.livePlatforms = new LivePlatformManager(this.config, this.eventBus);
    await this.livePlatforms.start();
    const enabled = this.livePlatforms.status().filter(status => status.enabled).map(status => `${status.platform}:${status.connected ? "connected" : status.lastError ?? "idle"}`);
    if (enabled.length) {
      console.log(`[Stelle] Live platform bridges: ${enabled.join(", ")}`);
    }
  }

  private async proposeSystemLiveOutput(source: "debug" | "system", input: Record<string, unknown>) {
    const text = String(input.text ?? "").trim();
    const eventId = `${source}-live-${Date.now()}`;
    const forceTopic = Boolean(input.forceTopic);
    const directSay = Boolean(input.directSay);
    const lane = source === "debug" ? "debug" : directSay ? "direct_response" : forceTopic ? "topic_hosting" : "live_chat";
    const decision = await this.stageOutput.propose({
      id: eventId,
      cursorId: source,
      sourceEventId: input.originMessageId ? String(input.originMessageId) : undefined,
      lane,
      priority: source === "debug" ? 80 : directSay ? 70 : 55,
      salience: directSay ? "high" : "medium",
      text,
      topic: forceTopic ? text : undefined,
      ttlMs: directSay ? 20_000 : 12_000,
      interrupt: directSay ? "soft" : "none",
      output: {
        caption: true,
        tts: Boolean(this.config.live.ttsEnabled),
      },
      metadata: {
        channelId: input.channelId ? String(input.channelId) : undefined,
        authorId: input.authorId ? String(input.authorId) : undefined,
        forceTopic,
        directSay,
      },
    });

    return {
      accepted: decision.status === "accepted" || decision.status === "interrupted",
      status: decision.status,
      reason: decision.reason,
      eventId,
    };
  }
}
