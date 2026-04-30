import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileTopicScriptMarkdown } from "../../src/live/program/topic_script_compiler.js";
import { TopicScriptRepository } from "../../src/live/program/topic_script_repository.js";
import { TopicScriptReviewService } from "../../src/live/program/topic_script_review.js";
import { TopicScriptService } from "../../src/live/program/topic_script_service.js";

describe("topic script review", () => {
  it("locks draft sections and preserves the revision", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "stelle-topic-review-"));
    const repository = new TopicScriptRepository({ rootDir, now: () => 1000 });
    const service = new TopicScriptService({ repository, now: () => 1000 });
    const review = new TopicScriptReviewService({ repository });
    const { draft } = await service.generateDraft({ templateId: "ai_reflection", scriptId: "ts_review" });
    const sectionId = draft.sections[0]!.section_id;

    const record = await review.lockSection({ scriptId: "ts_review", revision: 1, sectionId, actor: "test" });
    const markdown = await repository.readMarkdown("ts_review", 1);
    const next = compileTopicScriptMarkdown(markdown).draft;

    expect(record.status).toBe("draft");
    expect(next.sections[0]?.lock_level).toBe("locked");
  });

  it("does not mutate approved revisions in place", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "stelle-topic-review-"));
    const repository = new TopicScriptRepository({ rootDir, now: () => 1000 });
    const service = new TopicScriptService({ repository, now: () => 1000 });
    const review = new TopicScriptReviewService({ repository });
    const { draft } = await service.generateDraft({ templateId: "ai_reflection", scriptId: "ts_approved_lock" });
    await review.approve({ scriptId: "ts_approved_lock", revision: 1, actor: "test" });

    await expect(review.lockSection({ scriptId: "ts_approved_lock", revision: 1, sectionId: draft.sections[0]!.section_id })).rejects.toThrow(/Approved/);
  });
});
