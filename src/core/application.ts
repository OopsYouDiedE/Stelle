import path from "node:path";
import { loadRuntimeConfig, type RuntimeConfig } from "../utils/config_loader.js";
import { LlmClient } from "../utils/llm.js";
import { LiveRendererServer } from "../utils/renderer.js";
import { LiveRuntime, LocalLiveRendererBridge, ObsWebSocketController } from "../utils/live.js";
import { DiscordRuntime } from "../utils/discord.js";
import { MemoryStore } from "../utils/memory.js";
import { StelleCore } from "../utils/stelle_core.js";
import { createDefaultToolRegistry, type ToolRegistry } from "../tool.js";
import { RuntimeState } from "../runtime_state.js";
import { InnerCursor } from "../cursor/inner_cursor.js";
import { DiscordCursor } from "../cursor/discord_cursor.js";
import { LiveCursor } from "../cursor/live_cursor.js";
import type { StelleCursor, StelleEvent } from "../cursor/types.js";
import { eventBus } from "../utils/event_bus.js";
import { StelleScheduler } from "./scheduler.js";

export type StartMode = "runtime" | "discord" | "live";

export class StelleApplication {
  public readonly config: RuntimeConfig;
  public readonly state: RuntimeState;
  public readonly llm: LlmClient;
  public readonly memory: MemoryStore;
  public readonly discord: DiscordRuntime;
  public readonly tools: ToolRegistry;
  public readonly scheduler: StelleScheduler;
  
  public renderer?: LiveRendererServer;
  public live?: LiveRuntime;
  public core?: StelleCore;
  public cursors: StelleCursor[] = [];

  constructor(private readonly mode: StartMode) {
    this.config = loadRuntimeConfig();
    this.state = new RuntimeState();
    this.llm = new LlmClient(this.config.models);
    this.memory = new MemoryStore({
      rootDir: path.join(process.cwd(), "memory"),
      recentLimit: 50,
      llm: this.llm,
    });
    this.discord = new DiscordRuntime();
    this.live = new LiveRuntime(new ObsWebSocketController({ enabled: this.config.live.obsControlEnabled }));
    this.tools = createDefaultToolRegistry({ discord: this.discord, live: this.live, memory: this.memory, cwd: process.cwd() });
    this.scheduler = new StelleScheduler();
  }

  public async start(): Promise<void> {
    if (this.mode === "discord" && !this.config.discord.token) {
      throw new Error("Missing DISCORD_TOKEN for discord start mode.");
    }

    await this.memory.start();

    if (this.mode === "runtime" || this.mode === "live") {
      this.renderer = new LiveRendererServer({ host: this.config.live.rendererHost, port: this.config.live.rendererPort });
      const url = await this.renderer.start();
      process.env.LIVE_RENDERER_URL = url;
      this.live = new LiveRuntime(new ObsWebSocketController({ enabled: this.config.live.obsControlEnabled }), new LocalLiveRendererBridge(this.renderer));
      // Re-create tools with the updated live runtime reference
      (this as any).tools = createDefaultToolRegistry({ discord: this.discord, live: this.live, memory: this.memory, cwd: process.cwd() });
      this.state.record("renderer_started", `Live renderer ready: ${url}/live`);
      console.log(`[Stelle] Live renderer ready: ${url}/live`);
    }

    if (this.mode === "runtime") {
      this.core = new StelleCore({ llm: this.llm, memory: this.memory, intervalHours: this.config.core.reflectionIntervalHours });
    }

    await this.setupCursors();
    this.setupEventRouting();
    this.setupDebugController();

    if (this.mode !== "live" && this.config.discord.token) {
      await this.discord.login(this.config.discord.token);
      const discordCursor = this.cursors.find(c => c.id === "discord");
      await this.discord.setBotPresence({ window: discordCursor?.id ?? "unknown", detail: "runtime" }).catch(() => undefined);
      const status = await this.discord.getStatus();
      this.state.record("discord_connected", `Discord connected=${status.connected} botUserId=${status.botUserId ?? "unknown"}`);
      console.log(`[Stelle] Discord connected=${status.connected} botUserId=${status.botUserId ?? "unknown"}`);
    } else if (this.mode !== "live") {
      console.warn("[Stelle] DISCORD_TOKEN is not set; Discord runtime will not connect.");
    }

    if (this.core) {
      this.core.start();
      this.state.updateStelleCore(this.core.snapshot());
    }

    this.scheduler.start();
    this.state.updateCursors(this.cursors.map(c => c.snapshot()));
    this.state.record("runtime_started", `Runtime started in ${this.mode} mode.`);
    console.log(`[Stelle] Runtime started in ${this.mode} mode.`);
  }

  public async stop(): Promise<void> {
    this.scheduler.stop();
    await Promise.allSettled([
      this.discord.destroy(),
      this.renderer?.stop(),
      this.core?.stop()
    ]);
    this.state.record("runtime_stopped", "Runtime stopped.");
  }

  private async setupCursors() {
    const context = {
      llm: this.llm,
      tools: this.tools,
      config: this.config,
      memory: this.memory,
      publishEvent: (e: StelleEvent) => eventBus.publish(e),
      now: () => Date.now(),
    };

    const innerCursor = new InnerCursor(context);
    await innerCursor.initialize();
    
    const discordCursor = new DiscordCursor(context);
    const liveCursor = new LiveCursor(context);
    await liveCursor.initialize();

    this.cursors = [innerCursor, discordCursor, liveCursor];

    this.discord.onMessage((message) => {
      void discordCursor.receiveMessage(message).then(
        (result) => {
          this.state.record("discord_message", result.reason, { result });
          this.state.updateCursors(this.cursors.map(c => c.snapshot()));
        },
        (error) => {
          this.state.recordError(error);
          this.state.updateCursors(this.cursors.map(c => c.snapshot()));
        }
      );
    });
  }

  private setupEventRouting() {
    if (this.core) {
      eventBus.subscribe("core.tick", (event: Extract<StelleEvent, { type: "core.tick" }>) => {
        this.state.record("dispatch", event.type, { event });
        void this.core!.trigger(event.reason).then(() => {
          this.state.updateStelleCore(this.core!.snapshot());
        }).catch((e: unknown) => this.state.recordError(e));
      });
    }
  }

  private setupDebugController() {
    if (!this.renderer) return;

    this.renderer.setDebugController({
      getSnapshot: async () => {
        this.state.updateCursors(this.cursors.map(c => c.snapshot()));
        if (this.core) this.state.updateStelleCore(this.core.snapshot());
        return {
          runtime: this.state.snapshot(),
          tools: this.tools.list().map(t => ({ name: t.name, authority: t.authority, title: t.title })),
          audit: this.tools.audit.slice(-50),
          memory: await this.memory.snapshot(),
        };
      },
      useTool: (name, input) => {
        return this.tools.execute(name, input, {
          caller: "debug",
          cwd: process.cwd(),
          allowedAuthority: ["readonly", "safe_write", "network_read", "external_write"],
        });
      },
      sendLiveRequest: (input) => {
        const eventId = `debug-live-${Date.now()}`;
        eventBus.publish({ type: "live.request", source: "debug", payload: { ...input, text: String(input.text ?? "") }, id: eventId });
        return { accepted: true, reason: "Published to event bus", eventId };
      },
      sendLiveEvent: (input) => {
        const liveCursor = this.cursors.find(c => c.id === "live") as LiveCursor | undefined;
        return liveCursor ? liveCursor.receiveLiveEvent(input as any) : { ok: false, error: "LiveCursor not ready" };
      },
    });
  }
}
