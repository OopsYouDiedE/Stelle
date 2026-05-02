import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StelleEvent } from "../../../core/event/event_schema.js";
import { classifyText } from "./orchestrator.js";
import { PublicRoomMemoryStore } from "./public_memory.js";

// === Types ===

export interface EpisodeSummary {
  sessionId: string;
  generatedAt: number;
  topic: string;
  eventCount: number;
  interactionCount: number;
  clusterCounts: Record<string, number>;
  conclusions: string[];
  nextHook: string;
}

export interface EpisodeJournalRecord {
  sessionId: string;
  sequence: number;
  recordedAt: number;
  event: StelleEvent;
}

// === Public API ===

export async function generateEpisodeSummary(options: {
  journalPath: string;
  sessionId?: string;
  outputPath?: string;
  writePublicMemory?: boolean;
  publicMemory?: PublicRoomMemoryStore;
}): Promise<EpisodeSummary> {
  const records = await readEpisodeJournal(options.journalPath);
  const summary = summarizeRecords(records, options.sessionId ?? inferSessionId(options.journalPath));
  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  if (options.writePublicMemory) {
    await (options.publicMemory ?? new PublicRoomMemoryStore()).append({
      title: `直播复盘 ${summary.sessionId}`,
      summary: summary.conclusions.join(" "),
      source: "episode_summary",
    });
  }
  return summary;
}

// === Logic ===

export function summarizeRecords(records: EpisodeJournalRecord[], sessionId: string): EpisodeSummary {
  const clusterCounts: Record<string, number> = {};
  let interactionCount = 0;
  for (const { event } of records) {
    if (String(event.type) !== "perceptual.event" && String(event.type) !== "text.message") continue;
    const payload = (event as { payload?: unknown }).payload as
      | { payload?: { text?: unknown; kind?: unknown }; text?: unknown; kind?: unknown }
      | undefined;
    if (!payload) continue;
    const inner = payload.payload ?? payload;
    const kind = String(inner.kind ?? "text");
    if (kind !== "text" && kind !== "super_chat") continue;
    const label = classifyText(String(inner.text ?? ""));
    clusterCounts[label] = (clusterCounts[label] ?? 0) + 1;
    interactionCount += 1;
  }
  const top = Object.entries(clusterCounts).sort((a, b) => b[1] - a[1])[0];
  const conclusions = [
    top ? `本场讨论最集中在“${top[0]}”，共有 ${top[1]} 条相关输入。` : "本场没有足够输入形成观点分布。",
    interactionCount > 0 ? `共采样 ${interactionCount} 条讨论型输入。` : "本场讨论样本较少，适合下次继续收集。",
  ];
  return {
    sessionId,
    generatedAt: Date.now(),
    topic: "AI 主播应不应该记住观众？",
    eventCount: records.length,
    interactionCount,
    clusterCounts,
    conclusions,
    nextHook: top ? `下次可以继续追问“${top[0]}”背后的边界。` : "下次可以从一个更明确的问题开始。",
  };
}

// === Helpers ===

function inferSessionId(journalPath: string): string {
  return path.basename(path.dirname(path.resolve(journalPath)));
}

async function readEpisodeJournal(filePath: string): Promise<EpisodeJournalRecord[]> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EpisodeJournalRecord);
}
