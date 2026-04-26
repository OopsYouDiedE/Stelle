import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = normalizeMode(process.argv[2] ?? process.env.STELLE_STACK_MODE ?? "runtime");
const watch = process.argv.includes("--watch");
const built = process.argv.includes("--built");
const pythonExe = process.env.KOKORO_PYTHON || path.join(rootDir, ".venv", "Scripts", "python.exe");

const children = [];
const stelleChild = createStelleChild(mode, { watch, built });
const kokoroChild = mode === "discord" ? null : createKokoroChild();

children.push(stelleChild);

let shuttingDown = false;
let exitCode = 0;

for (const child of children) {
  child.process = spawn(child.command, child.args, {
    cwd: rootDir,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: false,
  });

  prefixStream(child.name, child.process.stdout);
  prefixStream(child.name, child.process.stderr);

  child.process.on("error", (error) => {
    console.error(`[${child.name}] failed to start: ${error.message}`);
    exitCode = 1;
    shutdown();
  });

  child.process.on("exit", (code, signal) => {
    if (shuttingDown) return;
    exitCode = code ?? (signal ? 1 : 0);
    console.error(`[${child.name}] exited${signal ? ` by ${signal}` : ` with code ${exitCode}`}`);
    shutdown();
  });

  if (child.name === "stelle" && child.startKokoroAfter && kokoroChild && !kokoroChild.process) {
    child.process.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      if (!text.includes("Runtime started")) return;
      startDeferredChild(kokoroChild);
    });
  }
}

if (mode === "live" && kokoroChild && !kokoroChild.process) {
  startDeferredChild(kokoroChild);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  for (const child of children) child.process?.kill();
});

function createStelleChild(targetMode, options) {
  if (options.watch) {
    return {
      name: "stelle",
      command: process.execPath,
      args: [resolveBin("tsx"), "watch", "src/start.ts", targetMode],
      startKokoroAfter: targetMode === "runtime",
    };
  }

  if (options.built) {
    return {
      name: "stelle",
      command: process.execPath,
      args: [path.join(rootDir, "dist", "start.js"), targetMode],
      startKokoroAfter: targetMode === "runtime",
    };
  }

  return {
    name: "stelle",
    command: process.execPath,
    args: [resolveBin("tsx"), "src/start.ts", targetMode],
    startKokoroAfter: targetMode === "runtime",
  };
}

function createKokoroChild() {
  return {
    name: "kokoro",
    command: pythonExe,
    args: [path.join(rootDir, "scripts", "kokoro_tts_server.py")],
    process: undefined,
  };
}

function startDeferredChild(child) {
  if (child.process) return;
  if (!children.includes(child)) children.push(child);
  child.process = spawn(child.command, child.args, {
    cwd: rootDir,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: false,
  });

  prefixStream(child.name, child.process.stdout);
  prefixStream(child.name, child.process.stderr);

  child.process.on("error", (error) => {
    console.error(`[${child.name}] failed to start: ${error.message}`);
    exitCode = 1;
    shutdown();
  });

  child.process.on("exit", (code, signal) => {
    if (shuttingDown) return;
    exitCode = code ?? (signal ? 1 : 0);
    console.error(`[${child.name}] exited${signal ? ` by ${signal}` : ` with code ${exitCode}`}`);
    shutdown();
  });
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.process || child.process.killed) continue;
    child.process.kill();
  }
  setTimeout(() => process.exit(exitCode), 350);
}

function prefixStream(name, stream) {
  stream?.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) console.log(`[${name}] ${line}`);
    }
  });
}

function resolveBin(binName) {
  return path.join(rootDir, "node_modules", ".bin", process.platform === "win32" ? `${binName}.cmd` : binName);
}

function normalizeMode(input) {
  const value = String(input).trim().toLowerCase();
  if (value === "discord" || value === "live" || value === "runtime") return value;
  throw new Error(`Unsupported stack mode: ${input}`);
}
