import "dotenv/config";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { fetchBilibiliDanmuInfo, resolveBilibiliRoom } from "../src/utils/bilibili_danmaku.js";
import { TopicScriptRepository } from "../src/live/controller/topic_script_repository.js";

type CheckLevel = "pass" | "warn" | "fail";

interface CheckResult {
  level: CheckLevel;
  name: string;
  detail: string;
}

const checks: CheckResult[] = [];
const jsonMode = process.argv.includes("--json");
const rendererUrl = (process.env.LIVE_RENDERER_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const roomId = Number(process.env.BILIBILI_ROOM_ID || firstNumericArg());

await checkEnv();
await checkFiles();
await checkTopicScripts();
await checkRenderer();
await checkBilibili();
checkPlatformSupport();
printReport();

if (checks.some((check) => check.level === "fail")) {
  process.exit(1);
}

async function checkEnv(): Promise<void> {
  const hasModelKey = Boolean(
    process.env.DASHSCOPE_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY,
  );
  add(
    hasModelKey ? "pass" : "fail",
    "LLM key",
    hasModelKey ? "model API key is configured" : "set DASHSCOPE_API_KEY or GEMINI_API_KEY before live",
  );

  const controlRequired = process.env.STELLE_CONTROL_REQUIRE_TOKEN !== "false";
  const hasControlToken = Boolean(process.env.STELLE_CONTROL_TOKEN || process.env.STELLE_DEBUG_TOKEN);
  add(
    !controlRequired || hasControlToken ? "pass" : "fail",
    "renderer control token",
    !controlRequired ? "token not required" : hasControlToken ? "token configured" : "set STELLE_CONTROL_TOKEN",
  );

  const ttsEnabled = process.env.LIVE_TTS_ENABLED !== "false";
  add(
    ttsEnabled ? "pass" : "warn",
    "live TTS",
    ttsEnabled ? "LIVE_TTS_ENABLED is on" : "TTS disabled; captions still work",
  );

  add(
    Number.isFinite(roomId) && roomId > 0 ? "pass" : "fail",
    "Bilibili room id",
    Number.isFinite(roomId) && roomId > 0 ? `room=${roomId}` : "set BILIBILI_ROOM_ID",
  );
  add(
    process.env.BILIBILI_COOKIE ? "pass" : "warn",
    "Bilibili cookie",
    process.env.BILIBILI_COOKIE ? "configured" : "not set; only needed if Bilibili returns code=-352",
  );
}

async function checkFiles(): Promise<void> {
  await checkPath("renderer build", "dist/live-renderer/index.html", "run npm run build first");
  if (process.env.LIVE_TTS_ENABLED === "false") return;
  const python = process.env.KOKORO_PYTHON ?? ".venv\\Scripts\\python.exe";
  await checkPath("Kokoro python", python, "install .venv or set LIVE_TTS_ENABLED=false for first dry run");
}

async function checkTopicScripts(): Promise<void> {
  const required = process.env.STELLE_TOPIC_SCRIPT_REQUIRED === "true";
  const repository = new TopicScriptRepository();
  try {
    const latest = await repository.latestApproved();
    if (!latest) {
      add(
        required ? "fail" : "warn",
        "topic script approved revision",
        required
          ? "no approved topic script found"
          : "no approved topic script found; runtime will continue without scripted hosting",
      );
      return;
    }
    const compiled = await repository.readCompiled(latest.scriptId, latest.revision);
    const hasFallbacks =
      compiled.sections.length > 0 && compiled.sections.every((section) => section.fallbackLines.length > 0);
    add(
      "pass",
      "topic script approved revision",
      `${latest.scriptId}#${latest.revision}, sections=${compiled.sections.length}`,
    );
    add(
      hasFallbacks ? "pass" : required ? "fail" : "warn",
      "topic script fallback lines",
      hasFallbacks ? "all sections have fallback lines" : "one or more sections are missing fallback lines",
    );
  } catch (error) {
    add(
      required ? "fail" : "warn",
      "topic script compiled artifact",
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function checkRenderer(): Promise<void> {
  try {
    const response = await fetch(`${rendererUrl}/state`);
    add(
      response.ok ? "pass" : "warn",
      "renderer HTTP",
      response.ok ? `${rendererUrl}/state ok` : `${rendererUrl}/state returned ${response.status}`,
    );
  } catch {
    add(
      "warn",
      "renderer HTTP",
      `renderer is not running yet at ${rendererUrl}; start npm run start:live or npm run start`,
    );
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
  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          ok: !checks.some((check) => check.level === "fail"),
          generatedAt: new Date().toISOString(),
          rendererUrl,
          checks,
          platforms: platformSupport(),
        },
        null,
        2,
      ),
    );
    return;
  }
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

function checkPlatformSupport(): void {
  for (const platform of platformSupport()) {
    add("pass", `${platform.platform} support level`, platform.level);
  }
}

function platformSupport(): Array<{ platform: string; level: "stable" | "beta" | "experimental"; note: string }> {
  return [
    { platform: "bilibili", level: "stable", note: "Primary production target for this repo." },
    {
      platform: "twitch",
      level: "beta",
      note: "IRC bridge exists; validate credentials and moderation before formal use.",
    },
    { platform: "youtube", level: "beta", note: "Data API polling bridge exists; quota and auth must be checked." },
    {
      platform: "tiktok",
      level: "experimental",
      note: "Optional websocket/provider path; dependency/provider may be external.",
    },
  ];
}

function firstNumericArg(): string | undefined {
  return process.argv.slice(2).find((arg) => /^\d+$/.test(arg));
}
