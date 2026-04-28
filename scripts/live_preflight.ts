import "dotenv/config";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { fetchBilibiliDanmuInfo, resolveBilibiliRoom } from "../src/utils/bilibili_danmaku.js";

type CheckLevel = "pass" | "warn" | "fail";

interface CheckResult {
  level: CheckLevel;
  name: string;
  detail: string;
}

const checks: CheckResult[] = [];
const rendererUrl = (process.env.LIVE_RENDERER_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const roomId = Number(process.env.BILIBILI_ROOM_ID || firstNumericArg());

await checkEnv();
await checkFiles();
await checkRenderer();
await checkBilibili();
printReport();

if (checks.some(check => check.level === "fail")) {
  process.exit(1);
}

async function checkEnv(): Promise<void> {
  const hasModelKey = Boolean(process.env.DASHSCOPE_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
  add(hasModelKey ? "pass" : "fail", "LLM key", hasModelKey ? "model API key is configured" : "set DASHSCOPE_API_KEY or GEMINI_API_KEY before live");

  const controlRequired = process.env.STELLE_CONTROL_REQUIRE_TOKEN !== "false";
  const hasControlToken = Boolean(process.env.STELLE_CONTROL_TOKEN || process.env.STELLE_DEBUG_TOKEN);
  add(
    !controlRequired || hasControlToken ? "pass" : "fail",
    "renderer control token",
    !controlRequired ? "token not required" : hasControlToken ? "token configured" : "set STELLE_CONTROL_TOKEN"
  );

  const ttsEnabled = process.env.LIVE_TTS_ENABLED !== "false";
  add(ttsEnabled ? "pass" : "warn", "live TTS", ttsEnabled ? "LIVE_TTS_ENABLED is on" : "TTS disabled; captions still work");

  add(Number.isFinite(roomId) && roomId > 0 ? "pass" : "fail", "Bilibili room id", Number.isFinite(roomId) && roomId > 0 ? `room=${roomId}` : "set BILIBILI_ROOM_ID");
  add(process.env.BILIBILI_COOKIE ? "pass" : "warn", "Bilibili cookie", process.env.BILIBILI_COOKIE ? "configured" : "not set; only needed if Bilibili returns code=-352");
}

async function checkFiles(): Promise<void> {
  await checkPath("renderer build", "dist/live-renderer/index.html", "run npm run build first");
  if (process.env.LIVE_TTS_ENABLED === "false") return;
  const python = process.env.KOKORO_PYTHON ?? ".venv\\Scripts\\python.exe";
  await checkPath("Kokoro python", python, "install .venv or set LIVE_TTS_ENABLED=false for first dry run");
}

async function checkRenderer(): Promise<void> {
  try {
    const response = await fetch(`${rendererUrl}/state`);
    add(response.ok ? "pass" : "warn", "renderer HTTP", response.ok ? `${rendererUrl}/state ok` : `${rendererUrl}/state returned ${response.status}`);
  } catch {
    add("warn", "renderer HTTP", `renderer is not running yet at ${rendererUrl}; start npm run start:live or npm run start`);
  }
}

async function checkBilibili(): Promise<void> {
  if (!Number.isFinite(roomId) || roomId <= 0) return;
  try {
    const room = await resolveBilibiliRoom(roomId);
    const danmu = await fetchBilibiliDanmuInfo(room.roomId);
    add("pass", "Bilibili danmaku API", `resolved room=${room.roomId}, hosts=${danmu.hostList.length}`);
  } catch (error) {
    add("fail", "Bilibili danmaku API", error instanceof Error ? error.message : String(error));
  }
}

async function checkPath(name: string, filePath: string, failDetail: string): Promise<void> {
  try {
    await access(filePath, constants.R_OK);
    add("pass", name, filePath);
  } catch {
    add("warn", name, failDetail);
  }
}

function add(level: CheckLevel, name: string, detail: string): void {
  checks.push({ level, name, detail });
}

function printReport(): void {
  console.log("\nStelle live preflight\n");
  for (const check of checks) {
    const mark = check.level === "pass" ? "OK" : check.level === "warn" ? "WARN" : "FAIL";
    console.log(`[${mark}] ${check.name}: ${check.detail}`);
  }
  console.log("");
  console.log("Start order:");
  console.log("1. npm run build");
  console.log("2. npm run start:live");
  console.log("3. Open OBS Browser Source: http://127.0.0.1:8787/live");
  console.log("4. npm run live:bilibili");
}

function firstNumericArg(): string | undefined {
  return process.argv.slice(2).find(arg => /^\d+$/.test(arg));
}
