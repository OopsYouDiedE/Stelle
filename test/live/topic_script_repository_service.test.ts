import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LlmClient } from "../../src/memory/llm.js";
import { TopicScriptRepository } from "../../src/live/controller/topic_script_repository.js";
import { TopicScriptService } from "../../src/live/controller/topic_script_service.js";

describe("topic script repository and service", () => {
  it("saves drafts, approves revisions, and writes compiled output", async () => {
    const rootDir = await tempRoot();
    const repository = new TopicScriptRepository({ rootDir, now: () => 1000 });
    const service = new TopicScriptService({ repository, now: () => 1000 });

    const { draft, record } = await service.generateDraft({ templateId: "ai_reflection", title: "AI 记忆边界", scriptId: "ts_repo_smoke" });

    expect(record.status).toBe("draft");
    expect(draft.sections.length).toBeGreaterThan(0);
    const approved = await repository.approveRevision("ts_repo_smoke", 1, "test");
    expect(approved.status).toBe("approved");
    const compiled = await repository.readCompiled("ts_repo_smoke", 1);
    expect(compiled.scriptId).toBe("ts_repo_smoke");
    expect(compiled.approvalStatus).toBe("approved");
  });

  it("uses LlmClient.generateJson when available", async () => {
    const rootDir = await tempRoot();
    const calls: string[] = [];
    const llm = {
      generateJson: async (_prompt: string, schemaName: string, normalize: (raw: unknown) => unknown) => {
        calls.push(schemaName);
        return normalize({
          script_id: "ts_llm_smoke",
          title: "弹幕法庭测试",
          summary: "LLM 生成的测试剧本",
          current_question: "你支持哪一边？",
          sections: [
            {
              section_id: "opening",
              phase: "opening",
              timestamp: "00:00",
              duration_sec: 60,
              goal: "开场",
              host_script: "欢迎来到弹幕法庭。",
              discussion_points: ["说明规则"],
              question_prompts: ["你支持正方还是反方？"],
              fallback_lines: ["先按低风险问题聊。"],
              handoff_rule: "收到观点后继续",
            },
          ],
        });
      },
    } as unknown as LlmClient;
    const service = new TopicScriptService({
      repository: new TopicScriptRepository({ rootDir }),
      llm,
      now: () => 1000,
    });

    const { draft } = await service.generateDraft({ templateId: "danmaku_court" });

    expect(calls).toContain("topic_script_draft");
    expect(draft.script_id).toBe("ts_llm_smoke");
    expect(draft.template_id).toBe("danmaku_court");
  });

  it("does not revise locked sections", async () => {
    const rootDir = await tempRoot();
    const service = new TopicScriptService({
      repository: new TopicScriptRepository({ rootDir }),
      llm: {
        generateJson: async () => {
          throw new Error("should not call llm for locked sections");
        },
      } as unknown as LlmClient,
    });
    const { draft } = await service.generateDraft({ templateId: "ai_reflection", scriptId: "ts_locked", revision: 1 });
    draft.sections[0]!.lock_level = "locked";

    const revised = await service.reviseSection({ draft, sectionId: draft.sections[0]!.section_id, viewerSignal: "这个事实不对" });

    expect(revised).toBe(draft);
  });
});

async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "stelle-topic-scripts-"));
}
