import "dotenv/config";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import { LiveRendererServer, startDiscordAttachedCoreMind } from "./index.js";
import { loadStelleModelConfig } from "./StelleConfig.js";
import type { LiveRendererDebugController } from "./live/renderer/LiveRendererServer.js";
import type { DiscordAttachedCoreMind } from "./stelle/DiscordAttachedCoreMind.js";

interface KokoroStartupOptions {
  enabled: boolean;
  autoStart: boolean;
  baseUrl: string;
  startTimeoutMs: number;
  warmupTimeoutMs: number;
}

interface KokoroStartupResult {
  process?: ChildProcessWithoutNullStreams;
  reachable: boolean;
  warmed: boolean;
}

class RuntimeDebugController implements LiveRendererDebugController {
  constructor(private readonly app: DiscordAttachedCoreMind) {}

  getSnapshot(): Promise<Record<string, unknown>> {
    return this.app.createDebugSnapshot();
  }

  switchCursor(cursorId: string, reason: string): Promise<void> {
    return this.app.switchCursorForDebug(cursorId, reason);
  }

  observeCursor(cursorId?: string): Promise<unknown> {
    return this.app.observeCursorForDebug(cursorId);
  }

  useTool(
    name: string,
    input: Record<string, unknown>,
    options?: { cursorId?: string; returnToInner?: boolean }
  ): Promise<unknown> {
    return this.app.useToolAsStelle(name, input, options);
  }

  sendDiscordMessage(input: {
    channel_id: string;
    content: string;
    mention_user_ids?: string[];
    reply_to_message_id?: string;
  }): Promise<unknown> {
    return this.app.sendStelleDiscordMessage(input);
  }

  getDiscordHistory(channelId?: string): unknown {
    return this.app.getDiscordLocalHistory(channelId);
  }
}

const mode = parseStartMode(process.argv[2] ?? process.env.STELLE_START_MODE);

switch (mode) {
  case "discord":
    await startDiscordCore();
    break;
  case "live":
    await startLiveRenderer();
    break;
  case "runtime":
    await startRuntime();
    break;
}

function parseStartMode(input?: string): "discord" | "live" | "runtime" {
  const normalized = String(input ?? "runtime").trim().toLowerCase();
  if (normalized === "discord" || normalized === "live" || normalized === "runtime") {
    return normalized;
  }

  throw new Error(`Unsupported start mode: ${input ?? ""}`);
}

async function startDiscordCore(): Promise<void> {
  const defaultChannelId = process.env.DISCORD_TEST_CHANNEL_ID;
  const app = await startDiscordAttachedCoreMind({ defaultChannelId });

  const status = await app.discordRuntime.getStatus();
  console.log(
    `[Stelle] Core Mind defaulted to Inner Cursor; Discord Cursor online. connected=${status.connected} botUserId=${status.botUserId ?? "unknown"} defaultChannel=${defaultChannelId ?? "unset"}`
  );

  process.on("SIGINT", () => {
    void app.stop().finally(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    void app.stop().finally(() => process.exit(0));
  });
}

async function startLiveRenderer(): Promise<void> {
  const port = process.env.LIVE_RENDERER_PORT ? Number(process.env.LIVE_RENDERER_PORT) : 8787;
  const host = process.env.LIVE_RENDERER_HOST ?? "127.0.0.1";
  const server = new LiveRendererServer({ host, port });
  const url = await server.start();

  console.log(`[Stelle] Live renderer ready: ${url}/live`);
  console.log("[Stelle] POST renderer commands to /command.");

  process.on("SIGINT", () => {
    void server.stop().finally(() => process.exit(0));
  });
}

async function startRuntime(): Promise<void> {
  const defaultChannelId = process.env.DISCORD_TEST_CHANNEL_ID;
  const livePort = process.env.LIVE_RENDERER_PORT ? Number(process.env.LIVE_RENDERER_PORT) : 8787;
  const liveHost = process.env.LIVE_RENDERER_HOST ?? "127.0.0.1";
  const liveTtsEnabled = process.env.LIVE_TTS_ENABLED !== "false";
  const kokoroAutoStart = process.env.KOKORO_AUTO_START !== "false";
  const liveTtsOutput = process.env.LIVE_TTS_OUTPUT ?? process.env.LIVE_AUDIO_OUTPUT ?? "browser";
  const kokoroBaseUrl = process.env.KOKORO_TTS_BASE_URL ?? "http://127.0.0.1:8880";
  const kokoroStartTimeoutMs = Number(process.env.KOKORO_START_TIMEOUT_MS ?? 45000);
  const kokoroWarmupTimeoutMs = Number(
    process.env.KOKORO_WARMUP_TIMEOUT_MS ?? process.env.KOKORO_START_TIMEOUT_MS ?? 45000
  );

  let stopping = false;
  let kokoroProcess: ChildProcessWithoutNullStreams | undefined;

  const liveServer = new LiveRendererServer({ host: liveHost, port: livePort });
  const liveUrl = await liveServer.start();
  process.env.LIVE_RENDERER_URL = liveUrl;

  const modelConfig = loadStelleModelConfig();
  logBootBanner({
    baseUrl: modelConfig.baseUrl,
    liveRuntimeUrl: liveUrl,
    liveTtsEnabled,
    liveTtsOutput,
    kokoroAutoStart,
    primaryModel: modelConfig.primaryModel,
    secondaryModel: modelConfig.secondaryModel,
  });

  kokoroProcess = await bootKokoroIfNeeded({
    baseUrl: kokoroBaseUrl,
    enabled: liveTtsEnabled,
    autoStart: kokoroAutoStart,
    startTimeoutMs: kokoroStartTimeoutMs,
    warmupTimeoutMs: kokoroWarmupTimeoutMs,
  });

  const app = await startDiscordAttachedCoreMind({ defaultChannelId });
  liveServer.setDebugController(new RuntimeDebugController(app));

  const status = await app.discordRuntime.getStatus();
  console.log(
    `[Stelle] Runtime online. Core Mind defaulted to Inner Cursor; Discord connected=${status.connected} botUserId=${status.botUserId ?? "unknown"} defaultChannel=${defaultChannelId ?? "unset"}`
  );
  console.log(`[Stelle] Debug console ready: ${liveServer.debugUrl}`);
  openExternalUrl(liveServer.debugUrl);

  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));

  async function stop(signal: string): Promise<void> {
    if (stopping) return;
    stopping = true;
    console.log(`[Stelle] Stopping runtime after ${signal}...`);

    if (kokoroProcess && !kokoroProcess.killed) {
      kokoroProcess.kill();
    }

    await Promise.allSettled([app.stop(), liveServer.stop()]);
    process.exit(0);
  }
}

function logBootBanner(options: {
  liveRuntimeUrl: string;
  primaryModel: string;
  secondaryModel: string;
  baseUrl?: string;
  liveTtsEnabled: boolean;
  liveTtsOutput: string;
  kokoroAutoStart: boolean;
}): void {
  console.log(`[Stelle] Live renderer ready: ${options.liveRuntimeUrl}/live`);
  console.log("[Stelle] OBS browser source should point at the live URL above.");
  console.log(
    `[Stelle] Text models: primary=${options.primaryModel} secondary=${options.secondaryModel} base=${options.baseUrl ?? "default"}`
  );
  console.log(
    `[Stelle] Live TTS enabled=${options.liveTtsEnabled}; output=${options.liveTtsOutput}; Kokoro auto-start=${options.kokoroAutoStart}; audio device=${process.env.KOKORO_AUDIO_DEVICE ?? "system default"}.`
  );
}

async function bootKokoroIfNeeded(options: KokoroStartupOptions): Promise<ChildProcessWithoutNullStreams | undefined> {
  if (!options.enabled) {
    console.log("[Stelle] Kokoro TTS startup skipped because LIVE_TTS_ENABLED=false.");
    return undefined;
  }

  if (!options.autoStart) {
    console.log("[Stelle] Kokoro TTS startup skipped because KOKORO_AUTO_START=false.");
    return undefined;
  }

  const startup = await ensureKokoroReady(options);

  if (startup.warmed) {
    console.log(`[Stelle] Kokoro TTS ready and warmed: ${options.baseUrl}`);
  } else {
    console.log(`[Stelle] Kokoro TTS did not become ready in time: ${options.baseUrl}`);
  }

  return startup.process;
}

async function ensureKokoroReady(options: KokoroStartupOptions): Promise<KokoroStartupResult> {
  if (!options.enabled || !options.autoStart) {
    return { reachable: false, warmed: false };
  }

  const healthUrl = `${options.baseUrl.replace(/\/+$/, "")}/health`;
  let process: ChildProcessWithoutNullStreams | undefined;
  let reachable = await canReach(healthUrl);

  if (!reachable) {
    console.log(`[Stelle] Kokoro TTS not reachable at ${healthUrl}; starting local Kokoro server...`);
    try {
      process = startKokoroProcess((code, signal) => {
        console.warn(`[Stelle] Kokoro process exited unexpectedly. code=${code ?? "null"} signal=${signal ?? "null"}`);
      });
    } catch (error) {
      throw new Error(`Failed to start Kokoro automatically: ${error instanceof Error ? error.message : String(error)}`);
    }
    reachable = await waitUntilReachable(healthUrl, options.startTimeoutMs);
  }

  const warmed = reachable && (await warmupKokoro(options.baseUrl, options.warmupTimeoutMs));
  return { process, reachable, warmed };
}

function startKokoroProcess(
  onUnexpectedExit: (code: number | null, signal: NodeJS.Signals | null) => void
): ChildProcessWithoutNullStreams {
  const python = process.env.KOKORO_PYTHON ?? ".venv\\Scripts\\python.exe";
  const script = process.env.KOKORO_SERVER_SCRIPT ?? "scripts\\kokoro_tts_server.py";
  if (!fs.existsSync(python)) {
    throw new Error(`Kokoro Python runtime not found: ${python}`);
  }
  if (!fs.existsSync(script)) {
    throw new Error(`Kokoro server script not found: ${script}`);
  }

  const child = spawn(python, [script], {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
  });

  child.stdout.on("data", (chunk) => process.stdout.write(`[Kokoro] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[Kokoro] ${chunk}`));
  child.on("exit", (code, signal) => onUnexpectedExit(code, signal));
  return child;
}

function openExternalUrl(url: string): void {
  if (process.env.STELLE_OPEN_DEBUG_WINDOW === "false") return;

  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }

  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

async function canReach(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilReachable(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canReach(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function warmupKokoro(baseUrl: string, timeoutMs: number): Promise<boolean> {
  if (process.env.KOKORO_WARMUP_ENABLED === "false") return true;

  const deadline = Date.now() + timeoutMs;
  const url = `${baseUrl.replace(/\/+$/, "")}${process.env.KOKORO_TTS_ENDPOINT_PATH ?? "/v1/audio/speech"}`;
  const body = {
    model: process.env.KOKORO_TTS_MODEL ?? "kokoro",
    input: process.env.KOKORO_WARMUP_TEXT ?? "你好，中文语音预热完成。",
    voice: process.env.KOKORO_TTS_VOICE ?? "zf_xiaobei",
    response_format: process.env.KOKORO_TTS_RESPONSE_FORMAT ?? "wav",
    language: process.env.KOKORO_TTS_LANGUAGE ?? "z",
  };

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "audio/wav" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        const bytes = (await response.arrayBuffer()).byteLength;
        console.log(`[Stelle] Kokoro TTS warmup complete: ${bytes} bytes.`);
        return true;
      }
      const detail = await response.text().catch(() => "");
      console.warn(`[Stelle] Kokoro TTS warmup failed with ${response.status}: ${detail || response.statusText}`);
    } catch (error) {
      console.warn(`[Stelle] Kokoro TTS warmup waiting: ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
}
