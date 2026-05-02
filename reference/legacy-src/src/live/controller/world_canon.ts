import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeExternalText, truncateText } from "../../utils/text.js";

export type WorldCanonStatus = "proposed" | "confirmed" | "rejected" | "archived";
export type WorldCanonSource = "manual" | "episode_summary" | "poll_result" | "danmaku_proposal";

export interface WorldCanonEntry {
  id: string;
  title: string;
  summary: string;
  status: WorldCanonStatus;
  version: number;
  source: WorldCanonSource;
  conflictNote?: string;
  createdAt: number;
  updatedAt: number;
}

export class WorldCanonStore {
  constructor(private readonly filePath = path.resolve("reference/legacy-src/memory/live/world_canon.json")) {}

  async propose(input: {
    title: string;
    summary: string;
    source?: WorldCanonSource;
    conflictNote?: string;
  }): Promise<WorldCanonEntry> {
    return this.add({ ...input, status: "proposed", source: input.source ?? "danmaku_proposal" });
  }

  async add(input: {
    title: string;
    summary: string;
    status: WorldCanonStatus;
    source: WorldCanonSource;
    conflictNote?: string;
  }): Promise<WorldCanonEntry> {
    if (input.source === "danmaku_proposal" && input.status === "confirmed") {
      throw new Error("Danmaku proposals cannot directly create confirmed canon.");
    }
    const entries = await this.list(1000);
    const now = Date.now();
    const entry: WorldCanonEntry = {
      id: `canon-${now}-${Math.random().toString(36).slice(2, 7)}`,
      title: truncateText(sanitizeExternalText(input.title), 80),
      summary: truncateText(sanitizeExternalText(input.summary), 320),
      status: input.status,
      version: nextVersion(entries),
      source: input.source,
      conflictNote: input.conflictNote ? truncateText(sanitizeExternalText(input.conflictNote), 240) : undefined,
      createdAt: now,
      updatedAt: now,
    };
    await this.write([...entries, entry]);
    return entry;
  }

  async updateStatus(id: string, status: WorldCanonStatus, conflictNote?: string): Promise<WorldCanonEntry | null> {
    const entries = await this.list(1000);
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    const current = entries[index]!;
    const updated: WorldCanonEntry = {
      ...current,
      status,
      conflictNote: conflictNote ? truncateText(sanitizeExternalText(conflictNote), 240) : current.conflictNote,
      updatedAt: Date.now(),
    };
    entries[index] = updated;
    await this.write(entries);
    return updated;
  }

  async list(limit = 20): Promise<WorldCanonEntry[]> {
    const raw = await readFile(this.filePath, "utf8").catch(() => "[]");
    const entries = JSON.parse(raw) as WorldCanonEntry[];
    return entries.slice(-Math.max(1, Math.min(1000, limit))).reverse();
  }

  private async write(entries: WorldCanonEntry[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
    await import("node:fs/promises").then((fs) => fs.rename(temp, this.filePath));
  }
}

function nextVersion(entries: WorldCanonEntry[]): number {
  return Math.max(0, ...entries.map((entry) => entry.version)) + 1;
}
