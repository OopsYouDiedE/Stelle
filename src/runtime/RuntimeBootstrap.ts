import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";

export interface KokoroStartupOptions {
  enabled: boolean;
  autoStart: boolean;
  baseUrl: string;
  startTimeoutMs: number;
  warmupTimeoutMs: number;
}

export interface KokoroStartupResult {
  process?: ChildProcessWithoutNullStreams;
  reachable: boolean;
  warmed: boolean;
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

export function startKokoroProcess(onUnexpectedExit: (code: number | null, signal: NodeJS.Signals | null) => void): ChildProcessWithoutNullStreams {
  const python = process.env.KOKORO_PYTHON ?? ".venv\\Scripts\\python.exe";
  const script = process.env.KOKORO_SERVER_SCRIPT ?? "scripts\\kokoro_tts_server.py";
  const resolvedPython = fs.existsSync(python) ? python : python;
  const resolvedScript = fs.existsSync(script) ? script : script;
  if (!fs.existsSync(resolvedPython)) {
    throw new Error(`Kokoro Python runtime not found: ${resolvedPython}`);
  }
  if (!fs.existsSync(resolvedScript)) {
    throw new Error(`Kokoro server script not found: ${resolvedScript}`);
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

export async function ensureKokoroReady(options: KokoroStartupOptions): Promise<KokoroStartupResult> {
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

export function openExternalUrl(url: string): void {
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
