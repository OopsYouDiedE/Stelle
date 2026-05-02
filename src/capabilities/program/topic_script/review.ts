import { compileTopicScriptMarkdown, renderTopicScriptMarkdown } from "./compiler.js";
import { TopicScriptRepository, type TopicScriptRevisionRecord } from "./repository.js";

// === Types ===

export interface TopicScriptReviewDeps {
  repository?: TopicScriptRepository;
}

// === Service ===

export class TopicScriptReviewService {
  readonly repository: TopicScriptRepository;

  constructor(deps: TopicScriptReviewDeps = {}) {
    this.repository = deps.repository ?? new TopicScriptRepository();
  }

  async approve({
    scriptId,
    revision,
    actor = "operator",
    note,
  }: {
    scriptId: string;
    revision: number;
    actor?: string;
    note?: string;
  }): Promise<TopicScriptRevisionRecord> {
    return this.repository.approveRevision(scriptId, revision, actor, note);
  }

  async archive({
    scriptId,
    revision,
    actor = "operator",
    note,
  }: {
    scriptId: string;
    revision: number;
    actor?: string;
    note?: string;
  }): Promise<TopicScriptRevisionRecord> {
    return this.repository.archiveRevision(scriptId, revision, actor, note);
  }

  async lockSection({
    scriptId,
    revision,
    sectionId,
    actor = "operator",
    note,
  }: {
    scriptId: string;
    revision: number;
    sectionId: string;
    actor?: string;
    note?: string;
  }): Promise<TopicScriptRevisionRecord> {
    const record = await this.repository.findRevision(scriptId, revision);
    if (!record) throw new Error(`Topic script revision not found: ${scriptId}#${revision}`);
    if (record.status === "approved") throw new Error("Approved topic script revisions cannot be modified in place.");

    const markdown = await this.repository.readMarkdown(scriptId, revision);
    const { draft } = compileTopicScriptMarkdown(markdown);

    const next = {
      ...draft,
      sections: draft.sections.map((section) =>
        section.section_id === sectionId ? { ...section, lock_level: "locked" as const } : section,
      ),
    };

    if (!next.sections.some((section) => section.section_id === sectionId && section.lock_level === "locked")) {
      throw new Error(`Section not found: ${sectionId}`);
    }

    return this.repository.importMarkdown(renderTopicScriptMarkdown(next), actor);
  }
}
