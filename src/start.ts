/**
 * 模块：Runtime 启动入口
 *
 * 运行逻辑：
 * 1. CLI 参数解析。
 * 2. 实例化 StelleApplication 并调用 start() 启动。
 * 3. 捕获系统中断信号(`SIGINT`, `SIGTERM`) 触发安全停止。
 */
import "dotenv/config";
import { StelleApplication, type StartMode } from "./core/application.js";

const mode = parseStartMode(process.argv[2] ?? process.env.STELLE_START_MODE);

if (isDirectStart()) {
  await start(mode).catch((error) => {
    console.error(`[Stelle] Failed to start: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

// 模块：对外启动入口。
export async function start(mode: StartMode = "runtime"): Promise<StelleApplication> {
  return startRuntime(mode);
}

// 模块：完整 runtime 装配和事件路由。
export async function startRuntime(mode: "runtime" | "discord" | "live" = "runtime"): Promise<StelleApplication> {
  const app = new StelleApplication(mode);
  await app.start();

  process.on("SIGINT", () => void app.stop().finally(() => process.exit(0)));
  process.on("SIGTERM", () => void app.stop().finally(() => process.exit(0)));
  return app;
}

// 模块：CLI 参数解析。
function parseStartMode(input?: string): StartMode {
  const value = String(input ?? "runtime")
    .trim()
    .toLowerCase();
  if (value === "runtime" || value === "discord" || value === "live") return value;
  throw new Error(`Unsupported start mode: ${input ?? ""}`);
}

function isDirectStart(): boolean {
  const entry = process.argv[1]?.replace(/\\/g, "/");
  return Boolean(
    entry === "src/start.ts" ||
    entry === "dist/start.js" ||
    entry?.endsWith("/start.ts") ||
    entry?.endsWith("/start.js"),
  );
}
