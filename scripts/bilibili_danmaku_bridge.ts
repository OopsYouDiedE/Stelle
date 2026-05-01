import "dotenv/config";
import { BilibiliDanmakuClient, type BilibiliCommand } from "../src/utils/bilibili_danmaku.js";

const roomId = Number(process.env.BILIBILI_ROOM_ID || firstNumericArg());
const rendererUrl = (process.env.LIVE_RENDERER_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const controlToken = process.env.STELLE_CONTROL_TOKEN ?? process.env.STELLE_DEBUG_TOKEN ?? "";
const dryRun = process.argv.includes("--dry-run");

if (!Number.isFinite(roomId) || roomId <= 0) {
  console.error("[bilibili] Missing BILIBILI_ROOM_ID. Usage: npm run live:bilibili -- <roomId>");
  process.exit(1);
}

const client = new BilibiliDanmakuClient({ roomId });
let forwarded = 0;

client.on("open", (status) => {
  console.log(`[bilibili] connected ${status.url}`);
});

client.on("authenticated", (status) => {
  console.log(`[bilibili] authenticated room=${status.roomId} requested=${status.requestedRoomId}`);
});

client.on("popularity", (value) => {
  console.log(`[bilibili] popularity ${value}`);
});

client.on("command", (command: BilibiliCommand) => {
  void forwardCommand(command).catch((error) => {
    console.error(`[bilibili] forward failed: ${error instanceof Error ? error.message : String(error)}`);
  });
});

client.on("close", () => {
  console.warn("[bilibili] connection closed; reconnecting if allowed");
});

client.on("error", (error) => {
  console.warn(`[bilibili] ${error instanceof Error ? error.message : String(error)}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`[bilibili] starting bridge room=${roomId}${dryRun ? " dry-run" : ""}`);
await startClientWithRetry();

async function startClientWithRetry(): Promise<void> {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      await client.start();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[bilibili] initial connection failed #${attempt}: ${message}`);
      if (attempt >= 10) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, attempt * 2_000)));
    }
  }
}

async function forwardCommand(command: BilibiliCommand): Promise<void> {
  const cmd = String(command.cmd ?? "UNKNOWN");
  if (!shouldForward(cmd)) return;

  const body = {
    id: `bilibili-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: "bilibili",
    roomId: String(client.status.roomId ?? roomId),
    cmd,
    priority: priorityForCommand(cmd),
    receivedAt: Date.now(),
    raw: command,
  };

  if (dryRun) {
    console.log(`[bilibili] dry-run ${cmd} ${summarizeCommand(command)}`);
    return;
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (controlToken) headers.authorization = `Bearer ${controlToken}`;
  const response = await fetch(`${rendererUrl}/api/live/event`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`);
  }
  forwarded += 1;
  console.log(`[bilibili] forwarded #${forwarded} ${cmd} ${summarizeCommand(command)}`);
}

function shouldForward(cmd: string): boolean {
  return (
    cmd === "DANMU_MSG" ||
    cmd === "SUPER_CHAT_MESSAGE" ||
    cmd === "SEND_GIFT" ||
    cmd === "GUARD_BUY" ||
    cmd === "INTERACT_WORD"
  );
}

function priorityForCommand(cmd: string): "low" | "medium" | "high" {
  if (cmd === "SUPER_CHAT_MESSAGE" || cmd === "GUARD_BUY") return "high";
  if (cmd === "SEND_GIFT") return "medium";
  return "low";
}

function summarizeCommand(command: BilibiliCommand): string {
  const raw = command as Record<string, unknown>;
  const info = raw.info;
  if (Array.isArray(info)) {
    const text = typeof info[1] === "string" ? info[1] : "";
    const user = Array.isArray(info[2]) ? String(info[2][1] ?? "") : "";
    return [user, text].filter(Boolean).join(": ");
  }
  const data = raw.data && typeof raw.data === "object" ? (raw.data as Record<string, unknown>) : {};
  return String(data.message ?? data.uname ?? data.giftName ?? data.gift_name ?? "");
}

function shutdown(): void {
  console.log("[bilibili] stopping bridge");
  client.stop();
  process.exit(0);
}

function firstNumericArg(): string | undefined {
  return process.argv.slice(2).find((arg) => /^\d+$/.test(arg));
}
