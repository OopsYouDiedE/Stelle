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
 * - readLongTerm/writeLongTerm/appendLongTerm: shared long-term state.
 * - appendResearchLog/readResearchLogs: StelleCore reflection logs.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeExternalText, truncateText } from "../utils/text.js";

export type MemoryScope =
  | { kind: "discord_channel"; channelId: string; guildId?: string | null }
  | { kind: "discord_global" }
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
  layers?: MemoryLayer[];
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

export const MEMORY_LAYERS = ["observations", "user_facts", "self_state", "core_identity", "research_logs"] as const;
export type MemoryLayer = (typeof MEMORY_LAYERS)[number];

export interface MemoryProposal {
  id: string;
  timestamp: number;
  authorId: string;
  source: string;
  content: string;
  reason: string;
  layer: MemoryLayer;
}

export type MemoryProposalStatus = "pending" | "approved" | "rejected";

export interface MemoryProposalDecision {
  id: string;
  proposalId: string;
  timestamp: number;
  status: Exclude<MemoryProposalStatus, "pending">;
  decidedBy: string;
  reason?: string;
  targetKey?: string;
  layer?: MemoryLayer;
}

export interface MemoryProposalView extends MemoryProposal {
  status: MemoryProposalStatus;
  decision?: MemoryProposalDecision;
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

  /**
   * Layer 1: Raw Observations (JSONL per session)
   */
  async writeRecent(scope: MemoryScope, entry: MemoryEntry): Promise<void> {
    await this.inScopeQueue(scope, async () => {
      const dir = this.scopeDir(scope);
      await mkdir(dir, { recursive: true });
      await atomicAppend(this.recentPath(scope), `${JSON.stringify(entry)}\n`);
      if (this.compactionEnabled && (await this.countRecent(scope)) >= this.recentLimit) {
        await this.createCheckpoint(scope);
      }
    });
  }

  async readRecent(scope: MemoryScope, limit = 20): Promise<MemoryEntry[]> {
    const file = this.recentPath(scope);
    const raw = await readFile(file, "utf8").catch(() => "");
    return parseJsonl<MemoryEntry>(raw).slice(-limit);
  }

  /**
   * Layer 2: Memory Proposals (Transient storage for non-owners)
   */
  async proposeMemory(proposal: Omit<MemoryProposal, "id" | "timestamp">): Promise<string> {
    const id = `prop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const fullProposal: MemoryProposal = { ...proposal, id, timestamp: Date.now() };

    await this.inScopeQueue({ kind: "long_term" }, async () => {
      const dir = path.join(this.rootDir, "long_term", "proposals");
      await mkdir(dir, { recursive: true });
      await atomicAppend(path.join(dir, "log.jsonl"), `${JSON.stringify(fullProposal)}\n`);
    });
    return id;
  }

  async listMemoryProposals(limit = 50, status: MemoryProposalStatus = "pending"): Promise<MemoryProposalView[]> {
    const proposals = await this.readProposalLog();
    const decisions = await this.readProposalDecisions();
    const decisionByProposal = new Map(decisions.map((decision) => [decision.proposalId, decision]));
    return proposals
      .map((proposal) => {
        const decision = decisionByProposal.get(proposal.id);
        return { ...proposal, status: decision?.status ?? "pending", decision } satisfies MemoryProposalView;
      })
      .filter((proposal) => status === "pending" ? proposal.status === "pending" : proposal.status === status)
      .slice(-Math.max(1, Math.min(200, limit)));
  }

  async approveMemoryProposal(
    proposalId: string,
    input: { decidedBy?: string; reason?: string; targetKey?: string } = {},
  ): Promise<{ proposalId: string; status: "approved"; key: string; layer: MemoryLayer }> {
    const proposal = (await this.listMemoryProposals(200, "pending")).find((item) => item.id === proposalId);
    if (!proposal) throw new Error(`Pending memory proposal not found: ${proposalId}`);
    const targetKey = input.targetKey ?? defaultProposalTargetKey(proposal);
    await this.appendLongTerm(targetKey, proposal.content, proposal.layer);
    await this.recordProposalDecision({
      id: `decision-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      proposalId,
      timestamp: Date.now(),
      status: "approved",
      decidedBy: input.decidedBy ?? "control",
      reason: input.reason,
      targetKey,
      layer: proposal.layer,
    });
    return { proposalId, status: "approved", key: targetKey, layer: proposal.layer };
  }

  async rejectMemoryProposal(
    proposalId: string,
    input: { decidedBy?: string; reason?: string } = {},
  ): Promise<{ proposalId: string; status: "rejected" }> {
    const proposal = (await this.listMemoryProposals(200, "pending")).find((item) => item.id === proposalId);
    if (!proposal) throw new Error(`Pending memory proposal not found: ${proposalId}`);
    await this.recordProposalDecision({
      id: `decision-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      proposalId,
      timestamp: Date.now(),
      status: "rejected",
      decidedBy: input.decidedBy ?? "control",
      reason: input.reason,
    });
    return { proposalId, status: "rejected" };
  }

  /**
   * Layer 3: Credibility Zones (Structured Long-Term Markdown)
   */
  async readLongTerm(key: string, layer: MemoryLayer = "observations"): Promise<string | null> {
    const file = path.join(this.rootDir, "long_term", layer, `${safeSegment(key)}.md`);
    return readFile(file, "utf8").catch(() => null);
  }

  async writeLongTerm(key: string, value: string, layer: MemoryLayer = "observations"): Promise<void> {
    await this.inScopeQueue({ kind: "long_term" }, async () => {
      const dir = path.join(this.rootDir, "long_term", layer);
      await mkdir(dir, { recursive: true });
      await atomicWrite(path.join(dir, `${safeSegment(key)}.md`), sanitizeExternalText(value));
    });
  }

  async appendLongTerm(key: string, value: string, layer: MemoryLayer = "observations"): Promise<void> {
    await this.inScopeQueue({ kind: "long_term" }, async () => {
      const dir = path.join(this.rootDir, "long_term", layer);
      await mkdir(dir, { recursive: true });
      const entry = [
        `## ${new Date().toISOString()}`,
        "",
        sanitizeExternalText(value),
        "",
      ].join("\n");
      await atomicAppend(path.join(dir, `${safeSegment(key)}.md`), entry);
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
    await this.inScopeQueue({ kind: "long_term" }, async () => {
      const dir = path.join(this.rootDir, "long_term", "research_logs");
      await mkdir(dir, { recursive: true });
      await atomicAppend(path.join(dir, "index.md"), text);
    });
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

  async searchHistory(scope: MemoryScope, query: MemorySearchQuery): Promise<HistorySummary[]> {
    const needles = [...(query.keywords ?? []), ...(query.text ? query.text.split(/\s+/) : [])]
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    if (scope.kind === "long_term") {
      return this.searchLongTerm(needles, query);
    }

    // 1. 搜索归档历史 (history.md)
    const historyPath = this.historyPath(scope);
    const historyRaw = await readFile(historyPath, "utf8").catch(() => "");
    const historyBlocks = historyRaw.split(/^## /m).filter((block) => block.trim());
    
    const historyResults = historyBlocks.map((block) => {
      const haystack = block.toLowerCase();
      const score = needles.length ? needles.reduce((sum, needle) => sum + (haystack.includes(needle) ? 1 : 0), 0) : 1;
      return { scope, path: historyPath, excerpt: truncateText(block.replace(/\s+/g, " "), 900), score };
    });

    // 2. 搜索最近记忆 (recent.jsonl)
    const recentEntries = await this.readRecent(scope, 100); // 搜索最近 100 条
    const recentResults = recentEntries.map((entry) => {
      const haystack = entry.text.toLowerCase();
      const score = needles.length ? needles.reduce((sum, needle) => sum + (haystack.includes(needle) ? 1.2 : 0), 0) : 1; // 给予最近记忆略高的权重
      return { 
        scope, 
        path: this.recentPath(scope), 
        excerpt: `[Recent] ${entry.source}: ${truncateText(entry.text, 500)}`, 
        score 
      };
    });

    // 3. 合并与排序
    const allResults = [...recentResults, ...historyResults]
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(20, query.limit ?? 3)));

    return allResults;
  }

  async snapshot(): Promise<Record<string, unknown>> {
    const channelRecentCounts = await this.countDiscordRecentEntries();
    return {
      rootDir: this.rootDir,
      recentLimit: this.recentLimit,
      compactionEnabled: this.compactionEnabled,
      channelRecentCounts,
      researchLogCount: (await this.readResearchLogs(1000)).length,
    };
  }

  private async countDiscordRecentEntries(): Promise<Record<string, number>> {
    const channelsDir = path.join(this.rootDir, "discord", "channels");
    const channelIds = await readdir(channelsDir).catch(() => []);
    const counts: Record<string, number> = {};
    await Promise.all(
      channelIds.map(async (channelId) => {
        const raw = await readFile(path.join(channelsDir, channelId, "recent.jsonl"), "utf8").catch(() => "");
        counts[channelId] = raw.split(/\r?\n/).filter((line) => line.trim()).length;
      })
    );
    return counts;
  }

  private async countRecent(scope: MemoryScope): Promise<number> {
    const raw = await readFile(this.recentPath(scope), "utf8").catch(() => "");
    return raw.split(/\r?\n/).filter((line) => line.trim()).length;
  }

  private async searchLongTerm(needles: string[], query: MemorySearchQuery): Promise<HistorySummary[]> {
    const layers = query.layers?.length ? query.layers : [...MEMORY_LAYERS];
    const results: HistorySummary[] = [];
    await Promise.all(layers.map(async (layer) => {
      const dir = path.join(this.rootDir, "long_term", layer);
      const files = await readdir(dir).catch(() => []);
      await Promise.all(files.filter((file) => file.endsWith(".md")).map(async (file) => {
        const fullPath = path.join(dir, file);
        const raw = await readFile(fullPath, "utf8").catch(() => "");
        if (!raw.trim()) return;
        const haystack = raw.toLowerCase();
        const score = needles.length ? needles.reduce((sum, needle) => sum + (haystack.includes(needle) ? 1 : 0), 0) : 1;
        if (score <= 0) return;
        const key = file.replace(/\.md$/i, "");
        results.push({
          scope: { kind: "long_term" },
          path: fullPath,
          excerpt: `[LongTerm:${layer}/${key}] ${truncateText(raw.replace(/\s+/g, " "), 900)}`,
          score,
        });
      }));
    }));
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(20, query.limit ?? 3)));
  }

  private async readProposalLog(): Promise<MemoryProposal[]> {
    const raw = await readFile(path.join(this.rootDir, "long_term", "proposals", "log.jsonl"), "utf8").catch(() => "");
    return parseJsonl<MemoryProposal>(raw);
  }

  private async readProposalDecisions(): Promise<MemoryProposalDecision[]> {
    const raw = await readFile(path.join(this.rootDir, "long_term", "proposals", "decisions.jsonl"), "utf8").catch(() => "");
    return parseJsonl<MemoryProposalDecision>(raw);
  }

  private async recordProposalDecision(decision: MemoryProposalDecision): Promise<void> {
    await this.inScopeQueue({ kind: "long_term" }, async () => {
      const dir = path.join(this.rootDir, "long_term", "proposals");
      await mkdir(dir, { recursive: true });
      await atomicAppend(path.join(dir, "decisions.jsonl"), `${JSON.stringify(decision)}\n`);
    });
  }

  // Module: compaction and checkpoint recovery.
  private async ensureStructure(): Promise<void> {
    await Promise.all([
      mkdir(path.join(this.rootDir, "discord", "channels"), { recursive: true }),
      mkdir(path.join(this.rootDir, "discord", "global"), { recursive: true }),
      mkdir(path.join(this.rootDir, "live"), { recursive: true }),
      mkdir(path.join(this.rootDir, "long_term", "research_logs"), { recursive: true }),
      mkdir(path.join(this.rootDir, "long_term", "proposals"), { recursive: true }),
      ...MEMORY_LAYERS.map((layer) => mkdir(path.join(this.rootDir, "long_term", layer), { recursive: true })),
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
    const entries = parseJsonl<MemoryEntry>(raw);
    if (!entries.length) {
      await rm(checkpointPath, { force: true });
      return;
    }

    const first = entries[0]!;
    const last = entries.at(-1)!;
    
    let keywords: string[];
    let participants: string[];
    let narrativeSummary: string;

    if (this.llm?.config.primary.apiKey || this.llm?.config.secondary.apiKey) {
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
          {
            role: "secondary",
            temperature: 0.3,
            safeDefault: {
              summary: truncateText(entries.map((entry) => `${entry.source}: ${entry.text}`).join(" | "), 1600),
              keywords: [...new Set(entries.flatMap((entry) => keywordSnippets(entry.text)).slice(0, 12))],
              participants: [...new Set(entries.map((e) => e.text.split(":")[0]?.trim()).filter((n) => n && n.length < 32))],
            },
          }
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

    await atomicAppend(this.historyPath(scope), output);
    await rm(checkpointPath, { force: true });
  }

  private async recoverCheckpoints(): Promise<void> {
    const roots = [path.join(this.rootDir, "live"), path.join(this.rootDir, "discord", "channels")];
    roots.push(path.join(this.rootDir, "discord", "global"));
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
    if (normalized.includes("/discord/global/checkpoint/")) return { kind: "discord_global" };
    const match = normalized.match(/\/discord\/channels\/([^/]+)\/checkpoint\//);
    if (match?.[1]) return { kind: "discord_channel", channelId: decodeURIComponent(match[1]) };
    return null;
  }

  // Module: path helpers and per-scope serialization queue.
  private scopeDir(scope: MemoryScope): string {
    if (scope.kind === "live") return path.join(this.rootDir, "live");
    if (scope.kind === "long_term") return path.join(this.rootDir, "long_term");
    if (scope.kind === "discord_global") return path.join(this.rootDir, "discord", "global");
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

function parseJsonl<T>(raw: string): T[] {
  const entries: T[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as T);
    } catch {
      // Ignore one corrupt JSONL line so the rest of memory remains readable.
    }
  }
  return entries;
}

function defaultProposalTargetKey(proposal: MemoryProposal): string {
  if (proposal.layer === "user_facts") return `user_${safeSegment(proposal.authorId)}`;
  return "approved_proposals";
}

function scopeLabel(scope: MemoryScope): string {
  if (scope.kind === "discord_channel") return `discord:${scope.channelId}`;
  if (scope.kind === "discord_global") return "discord:global";
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

async function atomicAppend(file: string, content: string): Promise<void> {
  const previous = await readFile(file, "utf8").catch(() => "");
  await atomicWrite(file, previous + content);
}
