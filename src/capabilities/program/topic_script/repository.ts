import fs from "node:fs/promises";
import path from "node:path";
import { compileTopicScriptDraft, compileTopicScriptMarkdown, renderTopicScriptMarkdown } from "./compiler.js";
import type { CompiledTopicScript, TopicScriptApprovalStatus, TopicScriptDraft } from "./topic_script_schema.js";

// === Types ===

export interface TopicScriptRevisionRecord {
  scriptId: string;
  revision: number;
  status: TopicScriptApprovalStatus;
  markdownPath: string;
  compiledPath?: string;
  createdAt: number;
  updatedAt: number;
  audit: Array<{ action: string; at: number; actor: string; note?: string }>;
}

export interface TopicScriptRepositoryIndex {
  revisions: TopicScriptRevisionRecord[];
}

export interface TopicScriptRepositoryOptions {
  rootDir?: string;
  now?: () => number;
}

// === Repository ===

export class TopicScriptRepository {
  private readonly rootDir: string;
  private readonly now: () => number;
  private initPromise?: Promise<void>;

  constructor(options: TopicScriptRepositoryOptions = {}) {
    this.rootDir = options.rootDir ?? path.join(process.cwd(), "data", "topic_scripts");
    this.now = options.now ?? (() => Date.now());
  }

  async saveDraft(draft: TopicScriptDraft, actor = "system"): Promise<TopicScriptRevisionRecord> {
    if (draft.approval_status === "approved") throw new Error("Use approveRevision to create approved topic scripts.");

    const normalized = { ...draft, approval_status: draft.approval_status ?? "draft" } as TopicScriptDraft;
    compileTopicScriptDraft(normalized);

    const existing = await this.findRevision(normalized.script_id, normalized.revision);
    if (existing?.status === "approved") throw new Error("Cannot overwrite an approved topic script revision.");

    const filePath = this.markdownPath("drafts", normalized.script_id, normalized.revision);
    await this.ensureDirs();
    await fs.writeFile(filePath, renderTopicScriptMarkdown(normalized), "utf8");

    return this.upsertRecord({
      scriptId: normalized.script_id,
      revision: normalized.revision,
      status: normalized.approval_status,
      markdownPath: filePath,
      createdAt: existing?.createdAt ?? this.now(),
      updatedAt: this.now(),
      audit: [...(existing?.audit ?? []), { action: "save_draft", at: this.now(), actor }],
    });
  }

  async importMarkdown(markdown: string, actor = "system"): Promise<TopicScriptRevisionRecord> {
    const { draft } = compileTopicScriptMarkdown(markdown);
    return this.saveDraft(draft, actor);
  }

  async approveRevision(
    scriptId: string,
    revision: number,
    actor = "operator",
    note?: string,
  ): Promise<TopicScriptRevisionRecord> {
    const current = await this.findRevision(scriptId, revision);
    if (!current) throw new Error(`Topic script revision not found: ${scriptId}#${revision}`);

    const markdown = await fs.readFile(current.markdownPath, "utf8");
    const { draft } = compileTopicScriptMarkdown(markdown);
    const approvedDraft: TopicScriptDraft = { ...draft, approval_status: "approved" };
    const compiled = compileTopicScriptDraft(approvedDraft);

    const markdownPath = this.markdownPath("approved", scriptId, revision);
    const compiledPath = this.compiledPath(scriptId, revision);

    await this.ensureDirs();
    await Promise.all([
      fs.writeFile(markdownPath, renderTopicScriptMarkdown(approvedDraft), "utf8"),
      fs.writeFile(compiledPath, `${JSON.stringify(compiled, null, 2)}\n`, "utf8"),
    ]);

    return this.upsertRecord({
      ...current,
      status: "approved",
      markdownPath,
      compiledPath,
      updatedAt: this.now(),
      audit: [...current.audit, { action: "approve", at: this.now(), actor, note }],
    });
  }

  async archiveRevision(
    scriptId: string,
    revision: number,
    actor = "operator",
    note?: string,
  ): Promise<TopicScriptRevisionRecord> {
    const current = await this.findRevision(scriptId, revision);
    if (!current) throw new Error(`Topic script revision not found: ${scriptId}#${revision}`);

    return this.upsertRecord({
      ...current,
      status: "archived",
      updatedAt: this.now(),
      audit: [...current.audit, { action: "archive", at: this.now(), actor, note }],
    });
  }

  async readMarkdown(scriptId: string, revision: number): Promise<string> {
    const record = await this.findRevision(scriptId, revision);
    if (!record) throw new Error(`Topic script revision not found: ${scriptId}#${revision}`);
    return fs.readFile(record.markdownPath, "utf8");
  }

  async readCompiled(scriptId: string, revision: number): Promise<CompiledTopicScript> {
    const record = await this.findRevision(scriptId, revision);
    if (!record?.compiledPath) throw new Error(`Compiled topic script not found: ${scriptId}#${revision}`);
    return JSON.parse(await fs.readFile(record.compiledPath, "utf8")) as CompiledTopicScript;
  }

  async latestApproved(): Promise<TopicScriptRevisionRecord | undefined> {
    const index = await this.readIndex();
    return index.revisions
      .filter((record) => record.status === "approved")
      .reduce(
        (latest, current) => (!latest || current.updatedAt > latest.updatedAt ? current : latest),
        undefined as TopicScriptRevisionRecord | undefined,
      );
  }

  async list(): Promise<TopicScriptRevisionRecord[]> {
    return (await this.readIndex()).revisions;
  }

  async findRevision(scriptId: string, revision: number): Promise<TopicScriptRevisionRecord | undefined> {
    const index = await this.readIndex();
    return index.revisions.find((record) => record.scriptId === scriptId && record.revision === revision);
  }

  private async upsertRecord(record: TopicScriptRevisionRecord): Promise<TopicScriptRevisionRecord> {
    const index = await this.readIndex();
    const otherRevisions = index.revisions.filter(
      (item) => !(item.scriptId === record.scriptId && item.revision === record.revision),
    );

    const next = [...otherRevisions, record];
    next.sort((a, b) => a.scriptId.localeCompare(b.scriptId) || a.revision - b.revision);

    await this.ensureDirs();
    await fs.writeFile(this.indexPath(), `${JSON.stringify({ revisions: next }, null, 2)}\n`, "utf8");
    return record;
  }

  private async readIndex(): Promise<TopicScriptRepositoryIndex> {
    try {
      const content = await fs.readFile(this.indexPath(), "utf8");
      const parsed = JSON.parse(content) as TopicScriptRepositoryIndex;
      return { revisions: Array.isArray(parsed.revisions) ? parsed.revisions : [] };
    } catch {
      return { revisions: [] };
    }
  }

  private async ensureDirs(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await Promise.all([
          fs.mkdir(path.join(this.rootDir, "drafts"), { recursive: true }),
          fs.mkdir(path.join(this.rootDir, "approved"), { recursive: true }),
          fs.mkdir(path.join(this.rootDir, "compiled"), { recursive: true }),
        ]);
      })();
    }
    return this.initPromise;
  }

  private markdownPath(bucket: "drafts" | "approved", scriptId: string, revision: number): string {
    return path.join(this.rootDir, bucket, `${safeFileName(scriptId)}.r${revision}.md`);
  }

  private compiledPath(scriptId: string, revision: number): string {
    return path.join(this.rootDir, "compiled", `${safeFileName(scriptId)}.r${revision}.json`);
  }

  private indexPath(): string {
    return path.join(this.rootDir, "index.json");
  }
}

// === Utils ===

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "topic_script";
}
