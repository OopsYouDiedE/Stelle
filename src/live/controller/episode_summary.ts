import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readLiveJournal, type LiveJournalRecord } from "./event_journal.js";
import { normalizeLiveEvent } from "../../utils/live_event.js";
import { classifyText } from "./orchestrator.js";
import { PublicRoomMemoryStore } from "./public_memory.js";

export interface EpisodeSummary {
  sessionId: string;
  generatedAt: number;
  topic: string;
  eventCount: number;
  danmakuCount: number;
  clusterCounts: Record<string, number>;
  conclusions: string[];
  nextHook: string;
}

export async function generateEpisodeSummary(options: {
  journalPath: string;
  sessionId?: string;
  outputPath?: string;
  writePublicMemory?: boolean;
  publicMemory?: PublicRoomMemoryStore;
}): Promise<EpisodeSummary> {
  const records = await readLiveJournal(options.journalPath);
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

export function summarizeRecords(records: LiveJournalRecord[], sessionId: string): EpisodeSummary {
  const clusterCounts: Record<string, number> = {};
  let danmakuCount = 0;
  for (const record of records) {
    if (record.event.type !== "live.event.received" && record.event.type !== "live.event.danmaku") continue;
    const liveEvent = normalizeLiveEvent(record.event.payload);
    if (liveEvent.kind !== "danmaku" && liveEvent.kind !== "super_chat") continue;
    const label = classifyText(liveEvent.text);
    clusterCounts[label] = (clusterCounts[label] ?? 0) + 1;
    danmakuCount += 1;
  }
  const top = Object.entries(clusterCounts).sort((a, b) => b[1] - a[1])[0];
  const conclusions = [
    top ? `本场讨论最集中在“${top[0]}”，共有 ${top[1]} 条相关输入。` : "本场没有足够弹幕形成观点分布。",
    danmakuCount > 0 ? `共采样 ${danmakuCount} 条讨论型弹幕。` : "本场讨论样本较少，适合下次继续收集。",
  ];
  return {
    sessionId,
    generatedAt: Date.now(),
    topic: "AI 主播应不应该记住观众？",
    eventCount: records.length,
    danmakuCount,
    clusterCounts,
    conclusions,
    nextHook: top ? `下次可以继续追问“${top[0]}”背后的边界。` : "下次可以从一个更明确的问题开始。",
  };
}

function inferSessionId(journalPath: string): string {
  return path.basename(path.dirname(path.resolve(journalPath)));
}
