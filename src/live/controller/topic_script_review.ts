import { compileTopicScriptMarkdown, renderTopicScriptMarkdown } from "./topic_script_compiler.js";
import { TopicScriptRepository, type TopicScriptRevisionRecord } from "./topic_script_repository.js";

export interface TopicScriptReviewDeps {
  repository?: TopicScriptRepository;
}

export class TopicScriptReviewService {
  readonly repository: TopicScriptRepository;

  constructor(deps: TopicScriptReviewDeps = {}) {
    this.repository = deps.repository ?? new TopicScriptRepository();
  }

  async approve(input: { scriptId: string; revision: number; actor?: string; note?: string }): Promise<TopicScriptRevisionRecord> {
    return this.repository.approveRevision(input.scriptId, input.revision, input.actor ?? "operator", input.note);
  }

  async archive(input: { scriptId: string; revision: number; actor?: string; note?: string }): Promise<TopicScriptRevisionRecord> {
    return this.repository.archiveRevision(input.scriptId, input.revision, input.actor ?? "operator", input.note);
  }

  async lockSection(input: { scriptId: string; revision: number; sectionId: string; actor?: string; note?: string }): Promise<TopicScriptRevisionRecord> {
    const record = await this.repository.findRevision(input.scriptId, input.revision);
    if (!record) throw new Error(`Topic script revision not found: ${input.scriptId}#${input.revision}`);
    if (record.status === "approved") throw new Error("Approved topic script revisions cannot be modified in place.");
    const markdown = await this.repository.readMarkdown(input.scriptId, input.revision);
    const { draft } = compileTopicScriptMarkdown(markdown);
    const next = {
      ...draft,
      sections: draft.sections.map(section => section.section_id === input.sectionId ? { ...section, lock_level: "locked" as const } : section),
    };
    if (!next.sections.some(section => section.section_id === input.sectionId && section.lock_level === "locked")) {
      throw new Error(`Section not found: ${input.sectionId}`);
    }
    return this.repository.importMarkdown(renderTopicScriptMarkdown(next), input.actor ?? "operator");
  }
}
