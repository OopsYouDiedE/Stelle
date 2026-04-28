import path from "node:path";
import { loadRuntimeConfig, type RuntimeConfig } from "../utils/config_loader.js";
import { LlmClient } from "../utils/llm.js";
import { LiveRendererServer } from "../utils/renderer.js";
import { LiveRuntime, LocalLiveRendererBridge, ObsWebSocketController } from "../utils/live.js";
import { DiscordRuntime } from "../utils/discord.js";
import { MemoryStore } from "../utils/memory.js";
import { createDefaultToolRegistry, type ToolRegistry } from "../tool.js";
import { RuntimeState } from "../runtime_state.js";
import type { StelleCursor, StelleEvent } from "../cursor/types.js";
import { cursorModules, isCursorEnabledByConfig } from "../cursor/registry.js";
import { StelleEventBus } from "../utils/event_bus.js";
import { StelleScheduler } from "./scheduler.js";
import { StageOutputArbiter } from "../stage/output_arbiter.js";
import { StageOutputRenderer } from "../stage/output_renderer.js";
import { DeviceActionArbiter } from "../device/action_arbiter.js";
import { MockDeviceActionDriver } from "../device/drivers/mock_driver.js";

export type StartMode = "runtime" | "discord" | "live";

export class StelleApplication {
  public readonly config: RuntimeConfig;
  public readonly state: RuntimeState;
  public readonly llm: LlmClient;
  public readonly memory: MemoryStore;
  public readonly discord: DiscordRuntime;
  public readonly eventBus: StelleEventBus;
  public tools: ToolRegistry;
  public readonly scheduler: StelleScheduler;
  public stageOutput: StageOutputArbiter;
  public deviceAction: DeviceActionArbiter;
  
  public renderer?: LiveRendererServer;
  public live?: LiveRuntime;
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
    this.eventBus = new StelleEventBus();
    this.live = new LiveRuntime(new ObsWebSocketController({ enabled: this.config.live.obsControlEnabled }));
    this.tools = createDefaultToolRegistry({ discord: this.discord, live: this.live, memory: this.memory, cwd: process.cwd() });
    this.stageOutput = this.createStageOutput();
    this.deviceAction = this.createDeviceAction();
    this.scheduler = new StelleScheduler({
      liveEnabled: mode === "runtime" || mode === "live",
      innerEnabled: true,
      innerTickMs: 45_000,
    });
  }

  public async start(): Promise<void> {
    if (this.mode === "discord" && !this.config.discord.token) {
      throw new Error("Missing DISCORD_TOKEN for discord start mode.");
    }

    await this.memory.start();

    if (this.mode === "runtime" || this.mode === "live") {
      this.renderer = new LiveRendererServer({
        host: this.config.live.rendererHost,
        port: this.config.live.rendererPort,
        debug: {
          enabled: this.config.debug.enabled,
          requireToken: this.config.debug.requireToken,
          token: this.config.debug.token,
        },
      });
      const url = await this.renderer.start();
      process.env.LIVE_RENDERER_URL = url;
      this.live = new LiveRuntime(new ObsWebSocketController({ enabled: this.config.live.obsControlEnabled }), new LocalLiveRendererBridge(this.renderer));
      await this.live.start();
      this.tools = createDefaultToolRegistry({ discord: this.discord, live: this.live, memory: this.memory, cwd: process.cwd() });
      this.stageOutput = this.createStageOutput();
      this.deviceAction = this.createDeviceAction();
      this.state.updateRenderer({ connected: true });
      this.state.record("renderer_started", `Live renderer ready: ${url}/live`);
      console.log(`[Stelle] Live renderer ready: ${url}/live`);
    }

    await this.setupCursors();
    this.setupEventRouting();
    this.setupDebugController();

    if (this.mode !== "live" && this.config.discord.token) {
      await this.discord.login(this.config.discord.token);
      const discordCursor = this.cursors.find(c => c.id === "discord_text_channel" || c.id === "discord");
      await this.discord.setBotPresence({ window: discordCursor?.id ?? "unknown", detail: "runtime" }).catch(() => undefined);
      const status = await this.discord.getStatus();
      this.state.updateDiscord({ connected: status.connected });
      this.state.record("discord_connected", `Discord connected=${status.connected} botUserId=${status.botUserId ?? "unknown"}`);
      console.log(`[Stelle] Discord connected=${status.connected} botUserId=${status.botUserId ?? "unknown"}`);
    } else if (this.mode !== "live") {
      console.warn("[Stelle] DISCORD_TOKEN is not set; Discord runtime will not connect.");
    }

    this.scheduler.start();
    this.state.updateCursors(this.cursors.map(c => c.snapshot()));
    this.state.record("runtime_started", `Runtime started in ${this.mode} mode.`);
    console.log(`[Stelle] Runtime started in ${this.mode} mode.`);
  }

  public async stop(): Promise<void> {
    this.scheduler.stop();
    await Promise.allSettled([
      ...this.cursors.map(c => c.stop?.()),
      this.discord.destroy(),
      this.renderer?.stop(),
    ]);
    this.state.updateDiscord({ connected: false });
    this.state.updateRenderer({ connected: false });
    this.state.record("runtime_stopped", "Runtime stopped.");
  }

  private async setupCursors() {
    const context = {
      llm: this.llm,
      tools: this.tools,
      config: this.config,
      memory: this.memory,
      eventBus: this.eventBus,
      stageOutput: this.stageOutput,
      deviceAction: this.deviceAction,
      now: () => Date.now(),
    };

    this.cursors = cursorModules
      .filter(module => module.enabledInModes.includes(this.mode))
      .filter(module => {
        // 1. Explicit Gating by Config
        if (module.id === "browser") return this.config.browser.enabled;
        return isCursorEnabledByConfig(module.id, this.config.rawYaml);
      })
      .filter(module => {
        // 2. Runtime Dependency Check (requires)
        if (!module.requires) return true;
        return module.requires.every(req => {
          if (req === "discord") return Boolean(this.config.discord.token);
          if (req === "live") return true; // Add live runtime check if needed
          if (req === "browser") return this.config.browser.enabled;
          return false;
        });
      })
      .map(module => module.create(context));

    // 并行初始化所有 Cursor
    await Promise.all(this.cursors.map(c => c.initialize?.()));

    this.discord.onMessage((message) => {
      this.eventBus.publish({
        type: "discord.text.message.received",
        source: "discord",
        id: `evt-${message.id}`,
        timestamp: Date.now(),
        payload: { message } // 携带完整摘要
      });
    });
    }

    private setupEventRouting() {
    // 路由内部调度事件到 EventBus
    this.scheduler.onTick((type, reason) => {
      this.eventBus.publish({ type: type as any, source: "scheduler", reason });
    });

    // 可以在这里监听反射事件来更新全局状态记录
    this.eventBus.subscribe("cursor.reflection", (event) => {
      this.state.record("cursor_reflection", event.payload.summary, event.payload);
    });
    }

    private setupDebugController() {
    if (!this.renderer) return;

    const liveController = {
      sendLiveRequest: async (input: Record<string, unknown>) => {
        return this.proposeSystemLiveOutput("system", input);
      },
      sendLiveEvent: (input: Record<string, unknown>) => {
        const eventId = `live-event-${Date.now()}`;
        this.eventBus.publish({
          type: "live.danmaku.received",
          source: "system",
          id: eventId,
          timestamp: Date.now(),
          payload: { ...input }
        } as any);
        return { accepted: true, reason: "Forwarded to event bus", eventId };
      },
    };


    this.renderer.setLiveController(liveController);

    if (!this.config.debug.enabled) {
      this.state.record("debug_disabled", "Debug controller is disabled by configuration.");
      return;
    }

    this.renderer.setDebugController({
      getSnapshot: async () => {
        this.state.updateCursors(this.cursors.map(c => c.snapshot()));
        const innerCursor = this.cursors.find(c => c.id === "inner");
        if (innerCursor) {
          const s = innerCursor.snapshot();
          this.state.updateStelleCore({
            lastReflectionAt: Number(s.state.lastCoreReflectionAt),
            currentFocusSummary: String(s.state.currentFocusSummary),
          });
        }

        const [discordStatus, liveStatus, memorySnapshot] = await Promise.all([
          this.discord.getStatus(),
          this.live?.getStatus(),
          this.memory.snapshot(),
        ]);
        this.state.updateDiscord({ connected: discordStatus.connected });
        if (this.renderer) this.state.updateRenderer({ connected: this.renderer.getStatus().connected });
        this.state.updateMemory({
          channelRecentCounts: (memorySnapshot.channelRecentCounts as Record<string, number> | undefined) ?? {},
          researchLogCount: Number(memorySnapshot.researchLogCount ?? 0),
        });
        return {
          runtime: this.state.snapshot(),
          discord: discordStatus,
          live: liveStatus,
          renderer: this.renderer?.getStatus(),
          stageOutput: this.stageOutput.snapshot(),
          tools: this.tools.list().map(t => ({ name: t.name, authority: t.authority, title: t.title })),
          audit: this.tools.audit.slice(-50),
          memory: memorySnapshot,
        };
      },
      useTool: (name, input) => {
        const { _bypassStage, ...toolInput } = input as any;
        return this.tools.execute(name, toolInput, {
          caller: "debug",
          cwd: process.cwd(),
          debugBypassStageOutput: !!_bypassStage,
          allowedAuthority: this.config.debug.allowExternalWrite
            ? ["readonly", "safe_write", "network_read", "external_write"]
            : ["readonly", "safe_write", "network_read"],
        });
      },
      sendLiveRequest: async (input) => {
        return this.proposeSystemLiveOutput("debug", input);
      },
      sendLiveEvent: liveController.sendLiveEvent,
    });
  }

  private createStageOutput(): StageOutputArbiter {
    return new StageOutputArbiter({
      renderer: new StageOutputRenderer({
        tools: this.tools,
        cwd: process.cwd(),
        ttsEnabled: Boolean(this.config.live.ttsEnabled),
      }),
      eventBus: this.eventBus,
      now: () => Date.now(),
      debugEnabled: Boolean(this.config.debug.enabled),
      maxQueueLength: this.config.live.speechQueueLimit || 5,
    });
  }

  private createDeviceAction(): DeviceActionArbiter {
    return new DeviceActionArbiter({
      drivers: [new MockDeviceActionDriver("browser")],
      eventBus: this.eventBus,
      now: () => Date.now(),
      // If browser is disabled, we pass no allowlist (Arbiter will default to deny all)
      // If browser is enabled, we pass the allowlist object (even if empty, it'll restrict)
      allowlist: this.config.browser.enabled ? (this.config.browser.allowlist as any) : undefined,
    });
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
