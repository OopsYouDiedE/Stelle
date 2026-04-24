import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  MEMORY_COLLECTIONS,
  type MemoryCollectionStats,
  type MemoryCollection,
  type MemoryRecord,
  type MemorySearchQuery,
  type MemorySearchResult,
} from "./types.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function clampLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? 20, 1), 100);
}

function sanitizeSegment(value: string): string {
  const normalized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");
  return normalized.replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^\.+|\.+$/g, "") || "untitled";
}

function isMemoryCollection(value: string): value is MemoryCollection {
  return MEMORY_COLLECTIONS.includes(value as MemoryCollection);
}

function toExcerpt(record: MemoryRecord, query?: string): string {
  const normalizedContent = record.content.replace(/\s+/g, " ").trim();
  if (!normalizedContent) return "";
  if (!query) return normalizedContent.slice(0, 180);

  const haystack = `${record.title ?? ""}\n${record.tags.join(" ")}\n${record.content}`;
  const index = haystack.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return normalizedContent.slice(0, 180);

  const compact = haystack.replace(/\s+/g, " ").trim();
  const start = Math.max(0, index - 60);
  const end = Math.min(compact.length, index + Math.max(query.length, 30) + 80);
  return compact.slice(start, end).trim();
}

function scoreRecord(record: MemoryRecord, filters: MemorySearchQuery): number {
  let score = 0;
  if (filters.id && record.id === filters.id) score += 100;
  if (filters.tag && record.tags.some((tag) => tag.toLowerCase() === filters.tag?.toLowerCase())) score += 30;
  if (filters.query) {
    const query = filters.query.toLowerCase();
    if (record.title?.toLowerCase().includes(query)) score += 20;
    if (record.content.toLowerCase().includes(query)) score += 15;
    if (record.tags.some((tag) => tag.toLowerCase().includes(query))) score += 10;
  }
  return score;
}

function parseMemoryFile(content: string, collection: MemoryCollection): MemoryRecord {
  const match = content.match(FRONTMATTER_RE);
  const frontmatter = match ? YAML.parse(match[1]) : {};
  const body = (match?.[2] ?? content).trim();
  const tags = Array.isArray(frontmatter?.tags)
    ? frontmatter.tags.map((item: unknown) => String(item))
    : [];
  const relatedIds = Array.isArray(frontmatter?.related_ids)
    ? frontmatter.related_ids.map((item: unknown) => String(item))
    : undefined;
  const metadata =
    frontmatter?.metadata && typeof frontmatter.metadata === "object" && !Array.isArray(frontmatter.metadata)
      ? (frontmatter.metadata as Record<string, unknown>)
      : undefined;

  return {
    id: String(frontmatter?.id ?? ""),
    collection,
    type: String(frontmatter?.type ?? collection),
    source: String(frontmatter?.source ?? "unknown"),
    createdAt: frontmatter?.created_at ? String(frontmatter.created_at) : undefined,
    updatedAt: String(frontmatter?.updated_at ?? new Date(0).toISOString()),
    title: frontmatter?.title ? String(frontmatter.title) : undefined,
    tags,
    relatedIds,
    metadata,
    content: body,
  };
}

function formatMemoryFile(record: MemoryRecord): string {
  const frontmatter: Record<string, unknown> = {
    id: record.id,
    type: record.type,
    source: record.source,
    updated_at: record.updatedAt,
  };
  if (record.createdAt) frontmatter.created_at = record.createdAt;
  if (record.title) frontmatter.title = record.title;
  if (record.tags.length) frontmatter.tags = record.tags;
  if (record.relatedIds?.length) frontmatter.related_ids = record.relatedIds;
  if (record.metadata && Object.keys(record.metadata).length) frontmatter.metadata = record.metadata;
  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${record.content.trim()}\n`;
}

export class MarkdownMemoryStore {
  constructor(private readonly rootDir = path.resolve(process.cwd(), "memory")) {}

  async ensureStructure(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await Promise.all(
      MEMORY_COLLECTIONS.map((collection) =>
        mkdir(path.join(this.rootDir, collection), { recursive: true })
      )
    );
  }

  async write(record: Omit<MemoryRecord, "updatedAt"> & { updatedAt?: string }): Promise<MemoryRecord & { path: string }> {
    await this.ensureStructure();
    const normalized: MemoryRecord = {
      ...record,
      id: record.id.trim(),
      title: record.title?.trim() || undefined,
      content: record.content.trim(),
      source: record.source.trim(),
      type: record.type.trim(),
      updatedAt: record.updatedAt ?? new Date().toISOString(),
      tags: [...new Set((record.tags ?? []).map((tag) => String(tag).trim()).filter(Boolean))],
      relatedIds: record.relatedIds?.map((item) => String(item).trim()).filter(Boolean) ?? undefined,
    };

    if (!normalized.id) throw new Error("Memory record id must not be empty.");
    if (!normalized.content) throw new Error("Memory record content must not be empty.");

    const filePath = this.resolveRecordPath(normalized.collection, normalized.id);
    await writeFile(filePath, formatMemoryFile(normalized), "utf8");
    return { ...normalized, path: filePath };
  }

  async read(collection: MemoryCollection, id: string): Promise<(MemoryRecord & { path: string }) | null> {
    await this.ensureStructure();
    const filePath = this.resolveRecordPath(collection, id);
    try {
      const content = await readFile(filePath, "utf8");
      return { ...parseMemoryFile(content, collection), path: filePath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async search(filters: MemorySearchQuery = {}): Promise<MemorySearchResult[]> {
    await this.ensureStructure();
    const collections = filters.collection ? [filters.collection] : [...MEMORY_COLLECTIONS];
    const files = await Promise.all(collections.map((collection) => this.listCollectionFiles(collection)));
    const matches: MemorySearchResult[] = [];

    for (const { collection, filePath } of files.flat()) {
      const raw = await readFile(filePath, "utf8");
      const record = parseMemoryFile(raw, collection);
      if (!record.id) continue;
      if (filters.id && record.id !== filters.id) continue;
      if (filters.tag && !record.tags.some((tag) => tag.toLowerCase() === filters.tag?.toLowerCase())) continue;
      if (filters.query) {
        const query = filters.query.toLowerCase();
        const haystack = `${record.title ?? ""}\n${record.tags.join(" ")}\n${record.content}`.toLowerCase();
        if (!haystack.includes(query)) continue;
      }

      matches.push({
        record,
        path: filePath,
        excerpt: toExcerpt(record, filters.query),
        score: scoreRecord(record, filters),
      });
    }

    return matches
      .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt))
      .slice(0, clampLimit(filters.limit));
  }

  async list(collection?: MemoryCollection): Promise<Array<MemoryRecord & { path: string }>> {
    await this.ensureStructure();
    const collections = collection ? [collection] : [...MEMORY_COLLECTIONS];
    const files = await Promise.all(collections.map((item) => this.listCollectionFiles(item)));
    const records: Array<MemoryRecord & { path: string }> = [];
    for (const { collection: currentCollection, filePath } of files.flat()) {
      const raw = await readFile(filePath, "utf8");
      records.push({ ...parseMemoryFile(raw, currentCollection), path: filePath });
    }
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async stats(): Promise<MemoryCollectionStats[]> {
    await this.ensureStructure();
    return Promise.all(
      MEMORY_COLLECTIONS.map(async (collection) => ({
        collection,
        count: (await this.listCollectionFiles(collection)).length,
      }))
    );
  }

  private resolveRecordPath(collection: MemoryCollection, id: string): string {
    const filename = `${sanitizeSegment(id)}.md`;
    return path.join(this.rootDir, collection, filename);
  }

  private async listCollectionFiles(collection: MemoryCollection): Promise<Array<{ collection: MemoryCollection; filePath: string }>> {
    const dir = path.join(this.rootDir, collection);
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => ({ collection, filePath: path.join(dir, entry.name) }));
  }
}

export function parseMemoryCollection(value: unknown): MemoryCollection | null {
  if (typeof value !== "string") return null;
  return isMemoryCollection(value) ? value : null;
}
