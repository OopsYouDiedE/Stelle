import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeExternalText, truncateText } from "../../utils/text.js";

export type PublicRoomMemorySource = "episode_summary" | "manual" | "poll_result" | "canon_update";

export interface PublicRoomMemory {
  id: string;
  title: string;
  summary: string;
  source: PublicRoomMemorySource;
  sensitivity: "public";
  createdAt: number;
}

export class PublicRoomMemoryStore {
  constructor(private readonly filePath = path.resolve("reference/legacy-src/memory/live/public_room_memory.jsonl")) {}

  async append(
    input: Omit<PublicRoomMemory, "id" | "createdAt" | "sensitivity"> & {
      id?: string;
      createdAt?: number;
      sensitivity?: "public";
    },
  ): Promise<PublicRoomMemory> {
    if (input.sensitivity && input.sensitivity !== "public")
      throw new Error("PublicRoomMemory only accepts public sensitivity.");
    const memory: PublicRoomMemory = {
      id: input.id ?? `public-memory-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: truncateText(sanitizeExternalText(input.title), 80),
      summary: truncateText(sanitizeExternalText(input.summary), 280),
      source: input.source,
      sensitivity: "public",
      createdAt: input.createdAt ?? Date.now(),
    };
    if (!memory.title || !memory.summary) throw new Error("PublicRoomMemory requires title and summary.");
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFileAtomic(this.filePath, `${JSON.stringify(memory)}\n`);
    return memory;
  }

  async list(limit = 12): Promise<PublicRoomMemory[]> {
    const raw = await readFile(this.filePath, "utf8").catch(() => "");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PublicRoomMemory)
      .filter((memory) => memory.sensitivity === "public")
      .slice(-Math.max(1, Math.min(50, limit)))
      .reverse();
  }
}

async function appendFileAtomic(file: string, content: string): Promise<void> {
  const previous = await readFile(file, "utf8").catch(() => "");
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, previous + content, "utf8");
  await import("node:fs/promises").then((fs) => fs.rename(temp, file));
}
