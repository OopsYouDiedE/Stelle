import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createTtsTools, ToolRegistry } from "../index.js";

const TEST_DIR = path.resolve("test");
const AUDIO_DIR = path.join(TEST_DIR, process.env.KOKORO_REAL_SMOKE_AUDIO_DIR ?? "kokoro-real-audio");
const RESULT_PATH = path.join(TEST_DIR, process.env.KOKORO_REAL_SMOKE_RESULT ?? "kokoro-real-tool-test.json");
const PORT = Number(process.env.KOKORO_REAL_SMOKE_PORT ?? 8890);
const TEXT = readSmokeText();
const VOICE = process.env.KOKORO_REAL_SMOKE_VOICE ?? "af_heart";
const LANGUAGE = process.env.KOKORO_REAL_SMOKE_LANGUAGE ?? "a";
const FILE_PREFIX = process.env.KOKORO_REAL_SMOKE_PREFIX ?? "kokoro-real";

async function main(): Promise<void> {
  await fs.mkdir(AUDIO_DIR, { recursive: true });
  const serverLog: string[] = [];
  const server = startServer(serverLog);
  try {
    await waitForHealth(`http://127.0.0.1:${PORT}/health`, 120_000);
    process.env.KOKORO_TTS_BASE_URL = `http://127.0.0.1:${PORT}`;
    process.env.KOKORO_TTS_ENDPOINT_PATH = "/v1/audio/speech";
    process.env.KOKORO_TTS_MODEL = "kokoro";
    process.env.KOKORO_TTS_VOICE = "af_heart";
    process.env.KOKORO_TTS_RESPONSE_FORMAT = "wav";

    const registry = new ToolRegistry();
    for (const tool of createTtsTools()) registry.register(tool);

    const result = await registry.execute("tts.kokoro_stream_speech", {
      chunks: [TEXT],
      output_dir: AUDIO_DIR,
      file_prefix: FILE_PREFIX,
      voice_name: VOICE,
      speed: 1,
      language: LANGUAGE,
    }, {
      caller: "stelle",
      authority: { caller: "stelle", allowedAuthorityClasses: ["stelle"] },
      audit: { record() {} },
    });

    await fs.writeFile(RESULT_PATH, JSON.stringify({
      ok: result.ok,
      summary: result.summary,
      data: result.data,
      request: { text: TEXT, voice: VOICE, language: LANGUAGE },
      serverLog: serverLog.slice(-80),
    }, null, 2), "utf8");

    if (!result.ok) throw new Error(result.summary);
    console.log(`Real Kokoro tool smoke output: ${RESULT_PATH}`);
  } finally {
    await stopServer(server);
  }
}

function startServer(log: string[]): ChildProcessWithoutNullStreams {
  const python = path.resolve(".venv", "Scripts", "python.exe");
  const serverPath = path.resolve("scripts", "kokoro_tts_server.py");
  const child = spawn(python, [serverPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      KOKORO_TTS_HOST: "127.0.0.1",
      KOKORO_TTS_PORT: String(PORT),
    },
  });
  child.stdout.on("data", (chunk) => log.push(chunk.toString()));
  child.stderr.on("data", (chunk) => log.push(chunk.toString()));
  return child;
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Kokoro server did not become healthy: ${lastError}`);
}

function stopServer(server: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve) => {
    if (server.exitCode !== null) {
      resolve();
      return;
    }
    server.once("exit", () => resolve());
    server.kill();
    setTimeout(() => resolve(), 3000).unref();
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function readSmokeText(): string {
  const escaped = process.env.KOKORO_REAL_SMOKE_TEXT_ESCAPED;
  if (escaped) return JSON.parse(`"${escaped.replace(/"/g, '\\"')}"`) as string;
  return process.env.KOKORO_REAL_SMOKE_TEXT ?? "Hello from the real Kokoro Python service.";
}
