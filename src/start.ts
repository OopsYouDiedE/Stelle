/**
 * 模块：Runtime 启动入口
 *
 * 运行逻辑：
 * 1. 从 `config.yaml` 和环境变量加载只读配置。
 * 2. 创建 Memory、LLM、ToolRegistry、DiscordRuntime、LiveRuntime、Renderer 和 Cursor。
 * 3. 根据启动模式连接 Discord、启动 Live renderer，并在 runtime 模式启动 StelleCore。
 * 4. Discord 消息进入后交给 DiscordCursor；跨 Cursor 请求通过本文件的 dispatch 路由。
 *
 * 主要方法：
 * - `start()`：CLI/API 统一入口，按模式分发。
 * - `startRuntime()`：完整运行时装配。
 * - `startLiveRendererOnly()`：只启动本地直播 renderer，便于前端 smoke test。
 */
import "dotenv/config";
import { loadRuntimeConfig } from "./utils/config_loader.js";
import { LlmClient } from "./utils/llm.js";
import { LiveRendererServer } from "./utils/renderer.js";
import { LiveRuntime, LocalLiveRendererBridge, ObsWebSocketController } from "./utils/live.js";
import { DiscordRuntime } from "./utils/discord.js";
import { MemoryStore } from "./utils/memory.js";
import { StelleCore } from "./utils/stelle_core.js";
import { createDefaultToolRegistry } from "./tool.js";
import { RuntimeState } from "./runtime_state.js";
import { InnerCursor } from "./cursor/inner_cursor.js";
import { DiscordCursor } from "./cursor/discord_cursor.js";
import { LiveCursor } from "./cursor/live_cursor.js";
import type { RuntimeDispatchEvent, RuntimeDispatchResult, CursorContext, StelleCursor } from "./cursor/types.js";

export type StartMode = "runtime" | "discord" | "live";

export interface StelleRuntime {
  cursors: StelleCursor[];
  state: RuntimeState;
  discord?: DiscordRuntime;
  renderer?: LiveRendererServer;
  live?: LiveRuntime;
  core?: StelleCore;
  stop(): Promise<void>;
}

const mode = parseStartMode(process.argv[2] ?? process.env.STELLE_START_MODE);

if (isDirectStart()) {
  await start(mode);
}

// 模块：对外启动入口。
export async function start(mode: StartMode = "runtime"): Promise<StelleRuntime | LiveRendererServer> {
  if (mode === "live") return startLiveRendererOnly();
  return startRuntime(mode);
}

// 模块：完整 runtime 装配和事件路由。
export async function startRuntime(mode: "runtime" | "discord" = "runtime"): Promise<StelleRuntime> {
  const config = loadRuntimeConfig();
  if (mode === "discord" && !config.discord.token) {
    throw new Error("Missing DISCORD_TOKEN for discord start mode.");
  }

  const state = new RuntimeState();
  const memory = new MemoryStore({
    rootDir: String(config.rawYaml.memory && typeof config.rawYaml.memory === "object" && "rootDir" in config.rawYaml.memory ? (config.rawYaml.memory as Record<string, unknown>).rootDir ?? "memory" : "memory"),
    recentLimit: 50,
  });
  await memory.start();

  const llm = new LlmClient(config.models);
  const renderer =
    mode === "runtime"
      ? new LiveRendererServer({ host: config.live.rendererHost, port: config.live.rendererPort })
      : undefined;
  if (renderer) {
    const url = await renderer.start();
    process.env.LIVE_RENDERER_URL = url;
    state.record("renderer_started", `Live renderer ready: ${url}/live`);
    console.log(`[Stelle] Live renderer ready: ${url}/live`);
  }

  const live = new LiveRuntime(new ObsWebSocketController({ enabled: config.live.obsControlEnabled }), renderer ? new LocalLiveRendererBridge(renderer) : undefined);
  const discord = new DiscordRuntime();
  const tools = createDefaultToolRegistry({ discord, live, memory, cwd: process.cwd() });
  const core =
    mode === "runtime"
      ? new StelleCore({
          llm,
          memory,
          intervalHours: config.core.reflectionIntervalHours,
        })
      : undefined;

  let liveCursor!: LiveCursor;
  const dispatch = async (event: RuntimeDispatchEvent): Promise<RuntimeDispatchResult> => {
    state.record("dispatch", event.type, { event });
    if (event.type === "live_request") return liveCursor.receiveDispatch(event);
    if (event.type === "core_tick" && core) {
      const result = await core.trigger(event.reason);
      state.updateStelleCore(core.snapshot());
      return { accepted: result.ok, reason: result.reason, eventId: result.researchLogId ?? `core-${Date.now()}` };
    }
    return { accepted: false, reason: `No handler for ${event.type}.`, eventId: `dispatch-${Date.now()}` };
  };

  const context: CursorContext = { llm, tools, config, memory, dispatch, now: () => Date.now() };
  const innerCursor = new InnerCursor();
  const discordCursor = new DiscordCursor(context);
  liveCursor = new LiveCursor(context);
  const cursors: StelleCursor[] = [innerCursor, discordCursor, liveCursor];

  renderer?.setDebugController({
    async getSnapshot() {
      state.updateCursors(cursors.map((cursor) => cursor.snapshot()));
      if (core) state.updateStelleCore(core.snapshot());
      return {
        runtime: state.snapshot(),
        tools: tools.list().map((tool) => ({ name: tool.name, authority: tool.authority, title: tool.title })),
        audit: tools.audit.slice(-50),
        memory: await memory.snapshot(),
      };
    },
    useTool(name, input) {
      return tools.execute(name, input, {
        caller: "debug",
        cwd: process.cwd(),
        allowedAuthority: ["readonly", "safe_write", "network_read", "external_write", "system"],
      });
    },
    sendLiveRequest(input) {
      return dispatch({ type: "live_request", source: "debug", payload: input });
    },
    sendLiveEvent(input) {
      return liveCursor.receiveLiveEvent(input);
    },
  });

  discord.onMessage((message) => {
    void discordCursor.receiveMessage(message).then(
      (result) => {
        state.record("discord_message", result.reason, { result });
        state.updateCursors(cursors.map((cursor) => cursor.snapshot()));
      },
      (error) => {
        state.recordError(error);
        state.updateCursors(cursors.map((cursor) => cursor.snapshot()));
      }
    );
  });

  if (!config.discord.token) {
    console.warn("[Stelle] DISCORD_TOKEN is not set; Discord runtime will not connect.");
  } else {
    await discord.login(config.discord.token);
    await discord.setBotPresence({ window: discordCursor.id, detail: "runtime" }).catch(() => undefined);
    const status = await discord.getStatus();
    state.record("discord_connected", `Discord connected=${status.connected} botUserId=${status.botUserId ?? "unknown"}`);
    console.log(`[Stelle] Discord connected=${status.connected} botUserId=${status.botUserId ?? "unknown"}`);
  }

  core?.start();
  if (core) state.updateStelleCore(core.snapshot());
  state.updateCursors(cursors.map((cursor) => cursor.snapshot()));
  state.record("runtime_started", `Runtime started in ${mode} mode.`);
  console.log(`[Stelle] Runtime started in ${mode} mode.`);

  const runtime: StelleRuntime = {
    cursors,
    state,
    discord,
    renderer,
    live,
    core,
    async stop() {
      await Promise.allSettled([discord.destroy(), renderer?.stop(), core?.stop()]);
      state.record("runtime_stopped", "Runtime stopped.");
    },
  };

  process.on("SIGINT", () => void runtime.stop().finally(() => process.exit(0)));
  process.on("SIGTERM", () => void runtime.stop().finally(() => process.exit(0)));
  return runtime;
}

// 模块：独立 renderer 启动，避免连接 Discord。
async function startLiveRendererOnly(): Promise<LiveRendererServer> {
  const config = loadRuntimeConfig();
  const server = new LiveRendererServer({ host: config.live.rendererHost, port: config.live.rendererPort });
  const url = await server.start();
  console.log(`[Stelle] Live renderer ready: ${url}/live`);
  return server;
}

// 模块：CLI 参数解析。
function parseStartMode(input?: string): StartMode {
  const value = String(input ?? "runtime").trim().toLowerCase();
  if (value === "runtime" || value === "discord" || value === "live") return value;
  throw new Error(`Unsupported start mode: ${input ?? ""}`);
}

function isDirectStart(): boolean {
  const entry = process.argv[1]?.replace(/\\/g, "/");
  return Boolean(entry === "src/start.ts" || entry === "dist/start.js" || entry?.endsWith("/start.ts") || entry?.endsWith("/start.js"));
}
