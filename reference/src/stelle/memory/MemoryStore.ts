import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type {
  MemoryEntry,
  MemoryReflection,
  MemoryStoreSnapshot,
} from "./types.js";

export class MemoryStore {
  private writtenCount = 0;
  private lastWrittenAt: number | null = null;
  private nextId = 1;

  constructor(
    private readonly filePath = path.resolve(
      process.cwd(),
      "memories",
      "stelle.md"
    )
  ) {}

  async remember(reflections: readonly MemoryReflection[]): Promise<MemoryEntry[]> {
    if (!reflections.length) return [];
    await mkdir(path.dirname(this.filePath), { recursive: true });

    const entries = reflections.map((reflection) => this.toEntry(reflection));
    await appendFile(
      this.filePath,
      entries.map(formatMemoryEntry).join("\n") + "\n",
      "utf8"
    );

    this.writtenCount += entries.length;
    this.lastWrittenAt = entries.at(-1)?.writtenAt ?? this.lastWrittenAt;
    return entries;
  }

  snapshot(): MemoryStoreSnapshot {
    return {
      path: this.filePath,
      writtenCount: this.writtenCount,
      lastWrittenAt: this.lastWrittenAt,
    };
  }

  private toEntry(reflection: MemoryReflection): MemoryEntry {
    return {
      ...reflection,
      id: `mem-${this.nextId++}`,
      writtenAt: Date.now(),
    };
  }
}

function formatMemoryEntry(entry: MemoryEntry): string {
  const writtenAt = new Date(entry.writtenAt).toISOString();
  const occurredAt = new Date(entry.createdAt).toISOString();
  return [
    `## ${entry.id} | ${writtenAt}`,
    "",
    `- source: ${entry.sourceKind}/${entry.sourceCursorId}`,
    `- experience: ${entry.experienceId} (${entry.experienceType})`,
    `- salience: ${entry.salience.toFixed(2)}`,
    `- occurred_at: ${occurredAt}`,
    `- reason: ${entry.reason}`,
    "",
    entry.summary,
    "",
  ].join("\n");
}
