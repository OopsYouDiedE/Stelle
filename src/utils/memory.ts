/**
 * Module: file-backed memory store
 *
 * Runtime flow:
 * - Recent memory is written as JSONL per scope.
 * - When recent memory reaches the configured limit, it is compacted into a readable history markdown block.
 * - Long-term memory is stored as key-value markdown files.
 * - StelleCore appends research logs under long_term/research_logs.
 *
 * Main methods:
 * - writeRecent/readRecent: scoped recent memory.
 * - searchHistory: keyword search over compacted history markdown.
 * - readLongTerm/writeLongTerm: shared long-term state.
 * - appendResearchLog/readResearchLogs: StelleCore reflection logs.
 */
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeExternalText, truncateText } from "./text.js";

export type MemoryScope =
  | { kind: "discord_channel"; channelId: string; guildId?: string | null }
  | { kind: "live" }
  | { kind: "long_term" };

export interface MemoryEntry {
  id: string;
  timestamp: number;
  source: "discord" | "live" | "core" | "debug";
  type: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface HistorySummary {
  scope: MemoryScope;
  path: string;
  excerpt: string;
  score: number;
}

export interface MemorySearchQuery {
  text?: string;
  keywords?: string[];
  limit?: number;
}

export interface ResearchLog {
  id?: string;
  timestamp?: number;
  focus: string;
  process: string[];
  conclusion: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryStoreOptions {
  rootDir?: string;
  recentLimit?: number;
  compactionEnabled?: boolean;
  llm?: import("./llm.js").LlmClient;
}

// Module: memory store public API.
export class MemoryStore {
  private readonly rootDir: string;
  private readonly recentLimit: number;
  private readonly compactionEnabled: boolean;
  private readonly llm?: import("./llm.js").LlmClient;
  private readonly queues = new Map<string, Promise<void>>();

  constructor(options: MemoryStoreOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? "memory");
    this.recentLimit = options.recentLimit ?? 50;
    this.compactionEnabled = options.compactionEnabled ?? true;
    this.llm = options.llm;
  }

  async start(): Promise<void> {
    await this.ensureStructure();
    await this.recoverCheckpoints();
  }

  async writeRecent(scope: MemoryScope, entry: MemoryEntry): Promise<void> {
    await this.inScopeQueue(scope, async () => {
      const dir = this.scopeDir(scope);
      await mkdir(dir, { recursive: true });
      await appendFile(this.recentPath(scope), `${JSON.stringify(entry)}\n`, "utf8");
      if (this.compactionEnabled && (await this.readRecent(scope, this.recentLimit + 1)).length >= this.recentLimit) {
        await this.createCheckpoint(scope);
      }
    });
  }

  async readRecent(scope: MemoryScope, limit = 20): Promise<MemoryEntry[]> {
    const file = this.recentPath(scope);
    const raw = await readFile(file, "utf8").catch(() => "");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MemoryEntry)
      .slice(-limit);
  }

  async searchHistory(scope: MemoryScope, query: MemorySearchQuery): Promise<HistorySummary[]> {
    const historyPath = this.historyPath(scope);
    const raw = await readFile(historyPath, "utf8").catch(() => "");
    if (!raw.trim()) return [];
    const needles = [...(query.keywords ?? []), ...(query.text ? query.text.split(/\s+/) : [])]
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    const blocks = raw.split(/^## /m).filter((block) => block.trim());
    const results = blocks
      .map((block) => {
        const haystack = block.toLowerCase();
        const score = needles.length ? needles.reduce((sum, needle) => sum + (haystack.includes(needle) ? 1 : 0), 0) : 1;
        return { scope, path: historyPath, excerpt: truncateText(block.replace(/\s+/g, " "), 900), score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(20, query.limit ?? 3)));
    return results;
  }

  async readLongTerm(key: string): Promise<string | null> {
    const file = path.join(this.rootDir, "long_term", `${safeSegment(key)}.md`);
    return readFile(file, "utf8").catch(() => null);
  }

  async writeLongTerm(key: string, value: string): Promise<void> {
    await this.inScopeQueue({ kind: "long_term" }, async () => {
      const dir = path.join(this.rootDir, "long_term");
      await mkdir(dir, { recursive: true });
      await atomicWrite(path.join(dir, `${safeSegment(key)}.md`), sanitizeExternalText(value));
    });
  }

  async appendResearchLog(log: ResearchLog): Promise<string> {
    const id = log.id ?? `research-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timestamp = log.timestamp ?? Date.now();
    const text = [
      `## ${new Date(timestamp).toISOString()} | ${id}`,
      "",
      `Focus: ${sanitizeExternalText(log.focus)}`,
      "Research process:",
      ...log.process.map((item) => `- ${sanitizeExternalText(item)}`),
      `Conclusion: ${sanitizeExternalText(log.conclusion)}`,
      "",
    ].join("\n");
    const dir = path.join(this.rootDir, "long_term", "research_logs");
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, "index.md"), text, "utf8");
    return id;
  }

  async readResearchLogs(limit = 8): Promise<string[]> {
    const file = path.join(this.rootDir, "long_term", "research_logs", "index.md");
    const raw = await readFile(file, "utf8").catch(() => "");
    return raw
      .split(/^## /m)
      .filter((block) => block.trim())
      .map((block) => `## ${block.trim()}`)
      .slice(-limit);
  }

  async snapshot(): Promise<Record<string, unknown>> {
    return {
      rootDir: this.rootDir,
      recentLimit: this.recentLimit,
      compactionEnabled: this.compactionEnabled,
      researchLogCount: (await this.readResearchLogs(1000)).length,
    };
  }

  // Module: compaction and checkpoint recovery.
  private async ensureStructure(): Promise<void> {
    await Promise.all([
      mkdir(path.join(this.rootDir, "discord", "channels"), { recursive: true }),
      mkdir(path.join(this.rootDir, "live"), { recursive: true }),
      mkdir(path.join(this.rootDir, "long_term", "research_logs"), { recursive: true }),
    ]);
  }

  private async createCheckpoint(scope: MemoryScope): Promise<void> {
    const recentPath = this.recentPath(scope);
    const checkpointDir = path.join(this.scopeDir(scope), "checkpoint");
    await mkdir(checkpointDir, { recursive: true });
    const checkpointPath = path.join(checkpointDir, `recent-${Date.now()}.jsonl`);
    await rename(recentPath, checkpointPath).catch(() => undefined);
    await writeFile(recentPath, "", "utf8");
    await this.compactCheckpoint(scope, checkpointPath);
  }

  private async compactCheckpoint(scope: MemoryScope, checkpointPath: string): Promise<void> {
    const raw = await readFile(checkpointPath, "utf8").catch(() => "");
    const entries = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MemoryEntry);
    if (!entries.length) {
      await rm(checkpointPath, { force: true });
      return;
    }

    const first = entries[0]!;
    const last = entries.at(-1)!;
    
    let keywords: string[];
    let participants: string[];
    let narrativeSummary: string;

    if (this.llm?.config.dashscopeApiKey || this.llm?.config.geminiApiKey) {
      const batchText = entries.map((e) => `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.source}: ${e.text}`).join("\n");
      const prompt = [
        "You are Stelle's Memory Compactor. Summarize the following chat/event batch into a concise narrative (max 2 sentences).",
        "Also extract main participants (user names) and 5-8 semantic keywords.",
        "Focus on the main topics, conflicts, active users, or emotional shifts.",
        `Context Scope: ${scopeLabel(scope)}`,
        'Schema: {"summary": "...", "keywords": ["..."], "participants": ["..."]}',
        `Batch Content:\n${batchText}`
      ].join("\n\n");

      try {
        const result = await this.llm.generateJson(
          prompt,
          "memory_compaction",
          (raw) => {
            const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
            return {
              summary: String(v.summary || ""),
              keywords: Array.isArray(v.keywords) ? v.keywords.map(String) : [],
              participants: Array.isArray(v.participants) ? v.participants.map(String) : []
            };
          },
          { role: "secondary", temperature: 0.3 }
        );
        narrativeSummary = result.summary;
        keywords = result.keywords;
        participants = result.participants;
      } catch (e) {
        console.warn("[Memory] LLM compaction failed, falling back to simple mode.", e);
        keywords = [...new Set(entries.flatMap((entry) => keywordSnippets(entry.text)).slice(0, 12))];
        participants = [...new Set(entries.map((e) => e.text.split(":")[0]?.trim()).filter((n) => n && n.length < 32))];
        narrativeSummary = truncateText(entries.map((entry) => `${entry.source}: ${entry.text}`).join(" | "), 1600);
      }
    } else {
      keywords = [...new Set(entries.flatMap((entry) => keywordSnippets(entry.text)).slice(0, 12))];
      participants = [...new Set(entries.map(e => e.text.split(":")[0]?.trim()).filter(n => n && n.length < 32))];
      narrativeSummary = truncateText(entries.map((entry) => `${entry.source}: ${entry.text}`).join(" | "), 1600);
    }

    const output = [
      `## ${new Date(last.timestamp).toISOString()} | ${scopeLabel(scope)}`,
      "",
      `Time window: ${new Date(first.timestamp).toISOString()} - ${new Date(last.timestamp).toISOString()}`,
      `Participants: [${participants.join(", ")}]`,
      `Keywords: [${keywords.join(", ")}]`,
      "Summary:",
      narrativeSummary,
      "",
      "--- RAW FRAGMENTS ---",
      truncateText(entries.map((e) => e.text).join(" | "), 800),
      "",
    ].join("\n");

    await appendFile(this.historyPath(scope), output, "utf8");
    await rm(checkpointPath, { force: true });
  }

  private async recoverCheckpoints(): Promise<void> {
    const roots = [path.join(this.rootDir, "live"), path.join(this.rootDir, "discord", "channels")];
    for (const root of roots) {
      await this.recoverCheckpointsUnder(root);
    }
  }

  private async recoverCheckpointsUnder(root: string): Promise<void> {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) await this.recoverCheckpointsUnder(full);
      if (!entry.isDirectory() || entry.name !== "checkpoint") continue;
      const files = await readdir(full).catch(() => []);
      for (const file of files.filter((item) => item.endsWith(".jsonl"))) {
        const checkpointPath = path.join(full, file);
        const scope = this.scopeFromCheckpointPath(checkpointPath);
        if (scope) await this.compactCheckpoint(scope, checkpointPath);
      }
    }
  }

  private scopeFromCheckpointPath(file: string): MemoryScope | null {
    const normalized = file.replace(/\\/g, "/");
    if (normalized.includes("/live/checkpoint/")) return { kind: "live" };
    const match = normalized.match(/\/discord\/channels\/([^/]+)\/checkpoint\//);
    if (match?.[1]) return { kind: "discord_channel", channelId: decodeURIComponent(match[1]) };
    return null;
  }

  // Module: path helpers and per-scope serialization queue.
  private scopeDir(scope: MemoryScope): string {
    if (scope.kind === "live") return path.join(this.rootDir, "live");
    if (scope.kind === "long_term") return path.join(this.rootDir, "long_term");
    return path.join(this.rootDir, "discord", "channels", safeSegment(scope.channelId));
  }

  private recentPath(scope: MemoryScope): string {
    return path.join(this.scopeDir(scope), "recent.jsonl");
  }

  private historyPath(scope: MemoryScope): string {
    return path.join(this.scopeDir(scope), "history.md");
  }

  private async inScopeQueue(scope: MemoryScope, task: () => Promise<void>): Promise<void> {
    const key = scopeLabel(scope);
    const pending = this.queues.get(key) ?? Promise.resolve();
    const next = pending.then(task, task);
    const tracked = next.catch(() => undefined);
    this.queues.set(key, tracked);
    void tracked.finally(() => {
      if (this.queues.get(key) === tracked) this.queues.delete(key);
    });
    await next;
  }
}

// Module: standalone helpers.
function safeSegment(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, "-") || "untitled";
}

function scopeLabel(scope: MemoryScope): string {
  if (scope.kind === "discord_channel") return `discord:${scope.channelId}`;
  return scope.kind;
}

function keywordSnippets(text: string): string[] {
  const clean = sanitizeExternalText(text).replace(/https?:\/\/\S+/g, " ");
  // 提取连续的字母数字或中文字符
  const matches = clean.match(/[\p{L}\p{N}]{2,12}/gu) || [];
  return matches.slice(0, 6);
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, file);
}
