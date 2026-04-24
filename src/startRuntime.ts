import "dotenv/config";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { LiveRendererServer, startDiscordAttachedCoreMind } from "./index.js";
import { loadStelleModelConfig } from "./config/StelleConfig.js";
import { RuntimeDebugController } from "./debug/RuntimeDebugController.js";
import { ensureKokoroReady, openExternalUrl } from "./runtime/RuntimeBootstrap.js";

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

logBootBanner(liveUrl, modelConfig.primaryModel, modelConfig.secondaryModel, modelConfig.baseUrl);
kokoroProcess = await bootKokoroIfNeeded();

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

async function bootKokoroIfNeeded(): Promise<ChildProcessWithoutNullStreams | undefined> {
  if (!liveTtsEnabled) {
    console.log("[Stelle] Kokoro TTS startup skipped because LIVE_TTS_ENABLED=false.");
    return undefined;
  }

  if (!kokoroAutoStart) {
    console.log("[Stelle] Kokoro TTS startup skipped because KOKORO_AUTO_START=false.");
    return undefined;
  }

  const startup = await ensureKokoroReady({
    enabled: liveTtsEnabled,
    autoStart: kokoroAutoStart,
    baseUrl: kokoroBaseUrl,
    startTimeoutMs: kokoroStartTimeoutMs,
    warmupTimeoutMs: kokoroWarmupTimeoutMs,
  });

  if (startup.warmed) {
    console.log(`[Stelle] Kokoro TTS ready and warmed: ${kokoroBaseUrl}`);
  } else {
    console.log(`[Stelle] Kokoro TTS did not become ready in time: ${kokoroBaseUrl}`);
  }

  return startup.process;
}

function logBootBanner(liveRuntimeUrl: string, primaryModel: string, secondaryModel: string, baseUrl?: string): void {
  console.log(`[Stelle] Live renderer ready: ${liveRuntimeUrl}/live`);
  console.log("[Stelle] OBS browser source should point at the live URL above.");
  console.log(
    `[Stelle] Text models: primary=${primaryModel} secondary=${secondaryModel} base=${baseUrl ?? "default"}`
  );
  console.log(
    `[Stelle] Live TTS enabled=${liveTtsEnabled}; output=${liveTtsOutput}; Kokoro auto-start=${kokoroAutoStart}; audio device=${process.env.KOKORO_AUDIO_DEVICE ?? "system default"}.`
  );
}

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
