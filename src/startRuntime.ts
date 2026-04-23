import "dotenv/config";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { LiveRendererServer, startDiscordAttachedCoreMind } from "./index.js";
import { loadStelleModelConfig } from "./config/StelleConfig.js";

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
    input: process.env.KOKORO_WARMUP_TEXT ?? "你好，直播语音预热完成。",
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

function startKokoroProcess(): ChildProcessWithoutNullStreams {
  const python = process.env.KOKORO_PYTHON ?? ".venv\\Scripts\\python.exe";
  const script = process.env.KOKORO_SERVER_SCRIPT ?? "scripts\\kokoro_tts_server.py";
  const child = spawn(python, [script], {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[Kokoro] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[Kokoro] ${chunk}`));
  child.on("exit", (code, signal) => {
    if (!stopping) console.warn(`[Stelle] Kokoro process exited unexpectedly. code=${code ?? "null"} signal=${signal ?? "null"}`);
  });
  return child;
}

const defaultChannelId = process.env.DISCORD_TEST_CHANNEL_ID ?? "1494546366808985710";
const livePort = process.env.LIVE_RENDERER_PORT ? Number(process.env.LIVE_RENDERER_PORT) : 8787;
const liveHost = process.env.LIVE_RENDERER_HOST ?? "127.0.0.1";
let stopping = false;
let kokoroProcess: ChildProcessWithoutNullStreams | undefined;

const liveServer = new LiveRendererServer({ host: liveHost, port: livePort });
const liveUrl = await liveServer.start();
process.env.LIVE_RENDERER_URL = liveUrl;
const modelConfig = loadStelleModelConfig();
const liveTtsEnabled = process.env.LIVE_TTS_ENABLED !== "false";
const kokoroAutoStart = process.env.KOKORO_AUTO_START !== "false";
const liveTtsOutput = process.env.LIVE_TTS_OUTPUT ?? process.env.LIVE_AUDIO_OUTPUT ?? "python-device";

console.log(`[Stelle] Live renderer ready: ${liveUrl}/live`);
console.log("[Stelle] OBS browser source should point at the live URL above.");
console.log(
  `[Stelle] Text models: primary=${modelConfig.primaryModel} secondary=${modelConfig.secondaryModel} base=${modelConfig.baseUrl ?? "default"}`
);
console.log(
  `[Stelle] Live TTS enabled=${liveTtsEnabled}; output=${liveTtsOutput}; Kokoro auto-start=${kokoroAutoStart}; audio device=${process.env.KOKORO_AUDIO_DEVICE ?? "system default"}.`
);

if (liveTtsEnabled && kokoroAutoStart) {
  const kokoroUrl = process.env.KOKORO_TTS_BASE_URL ?? "http://127.0.0.1:8880";
  const healthUrl = `${kokoroUrl.replace(/\/+$/, "")}/health`;
  let reachable = await canReach(healthUrl);
  if (!reachable) {
    console.log(`[Stelle] Kokoro TTS not reachable at ${healthUrl}; starting local Kokoro server...`);
    kokoroProcess = startKokoroProcess();
    reachable = await waitUntilReachable(healthUrl, Number(process.env.KOKORO_START_TIMEOUT_MS ?? 45000));
  }
  const warmed = reachable && (await warmupKokoro(kokoroUrl, Number(process.env.KOKORO_WARMUP_TIMEOUT_MS ?? process.env.KOKORO_START_TIMEOUT_MS ?? 45000)));
  console.log(warmed ? `[Stelle] Kokoro TTS ready and warmed: ${kokoroUrl}` : `[Stelle] Kokoro TTS did not become ready in time: ${kokoroUrl}`);
} else if (!liveTtsEnabled) {
  console.log("[Stelle] Kokoro TTS startup skipped because LIVE_TTS_ENABLED=false.");
} else {
  console.log("[Stelle] Kokoro TTS startup skipped because KOKORO_AUTO_START=false.");
}

const app = await startDiscordAttachedCoreMind({ defaultChannelId });
const status = await app.discordRuntime.getStatus();
console.log(
  `[Stelle] Runtime online. Core Mind defaulted to Inner Cursor; Discord connected=${status.connected} botUserId=${status.botUserId ?? "unknown"} defaultChannel=${defaultChannelId}`
);

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

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
