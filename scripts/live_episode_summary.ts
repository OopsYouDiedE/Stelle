import "dotenv/config";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { generateEpisodeSummary } from "../src/capabilities/program/stage_director/episode_summary.js";

const sessionsRoot = path.resolve("artifacts/live-sessions");
const sessionId = process.argv.find((arg) => arg.startsWith("--session="))?.split("=")[1] ?? (await latestSessionId());
const writePublicMemory = process.argv.includes("--write-public-memory");

if (!sessionId) {
  console.error("No live session found under artifacts/live-sessions.");
  process.exit(1);
}

const sessionDir = path.join(sessionsRoot, sessionId);
const journalPath = path.join(sessionDir, "events.jsonl");
const outputPath = path.join(sessionDir, "episode_summary.json");
const summary = await generateEpisodeSummary({ journalPath, sessionId, outputPath, writePublicMemory });
console.log(JSON.stringify({ outputPath, summary }, null, 2));

async function latestSessionId(): Promise<string | undefined> {
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .at(-1);
}
