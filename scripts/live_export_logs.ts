import "dotenv/config";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sessionsRoot = path.resolve("artifacts/live-sessions");
const outputDir = path.resolve("artifacts/live-support-bundles");
const sessionId = process.argv.find(arg => arg.startsWith("--session="))?.split("=")[1] ?? await latestSessionId();

if (!sessionId) {
  console.error("No live session found under artifacts/live-sessions.");
  process.exit(1);
}

await mkdir(outputDir, { recursive: true });
const bundlePath = path.join(outputDir, `${sessionId}.json`);
const eventPath = path.join(sessionsRoot, sessionId, "events.jsonl");
const eventsRaw = await readFile(eventPath, "utf8").catch(() => "");
const configRaw = await readFile("config.yaml", "utf8").catch(() => "");

await writeFile(bundlePath, JSON.stringify({
  sessionId,
  generatedAt: new Date().toISOString(),
  eventPath,
  events: eventsRaw.split(/\r?\n/).filter(Boolean).slice(-500).map(line => JSON.parse(line)),
  configSummary: redact(configRaw),
  envSummary: {
    liveTtsEnabled: process.env.LIVE_TTS_ENABLED !== "false",
    ttsProvider: process.env.STELLE_TTS_PROVIDER ?? process.env.LIVE_TTS_PROVIDER ?? "kokoro",
    bilibiliRoomConfigured: Boolean(process.env.BILIBILI_ROOM_ID),
    obsControlEnabled: process.env.OBS_CONTROL_ENABLED === "true",
  },
}, null, 2), "utf8");

console.log(bundlePath);

async function latestSessionId(): Promise<string | undefined> {
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort().at(-1);
}

function redact(value: string): string {
  return value
    .replace(/(api[_-]?key\s*[:=]\s*)(.+)/gi, "$1[redacted]")
    .replace(/(token\s*[:=]\s*)(.+)/gi, "$1[redacted]")
    .replace(/(cookie\s*[:=]\s*)(.+)/gi, "$1[redacted]");
}
