import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { StageOutputArbiter } from "../../src/stage/output_arbiter.js";
import type { OutputIntent } from "../../src/stage/output_types.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";
import { TopicScriptRepository } from "../../src/live/program/topic_script_repository.js";
import { TopicScriptService } from "../../src/live/program/topic_script_service.js";
import { TopicScriptRuntimeService } from "../../src/live/program/topic_script_runtime.js";

describe("topic script runtime", () => {
  it("loads the latest approved script and proposes the first section through StageOutput", async () => {
    const { repository } = await approvedRepository();
    const intents: OutputIntent[] = [];
    const runtime = new TopicScriptRuntimeService({
      eventBus: new StelleEventBus(),
      repository,
      stageOutput: fakeStageOutput(intents),
      now: () => 1000,
    });

    await runtime.start();

    expect(runtime.snapshot().status).toBe("running");
    expect(intents[0]?.cursorId).toBe("topic_script_runtime");
    expect(intents[0]?.lane).toBe("topic_hosting");
    expect(intents[0]?.metadata?.script_id).toBe("ts_runtime");
  });

  it("turns viewer questions into direct responses without bypassing StageOutput", async () => {
    const { repository } = await approvedRepository();
    const eventBus = new StelleEventBus();
    const intents: OutputIntent[] = [];
    const runtime = new TopicScriptRuntimeService({
      eventBus,
      repository,
      stageOutput: fakeStageOutput(intents),
      now: () => 1000,
    });
    await runtime.start();

    eventBus.publish({
      type: "live.event.received",
      source: "fixture",
      payload: { id: "q1", source: "fixture", cmd: "DANMU_MSG", text: "为什么要记住观众？" },
    });
    await Promise.resolve();

    expect(intents.some(intent => intent.lane === "direct_response" && intent.text.includes("为什么"))).toBe(true);
    expect(runtime.snapshot().interruptedCount).toBe(1);
  });
});

async function approvedRepository(): Promise<{ repository: TopicScriptRepository }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "stelle-topic-runtime-"));
  const repository = new TopicScriptRepository({ rootDir, now: () => 1000 });
  const service = new TopicScriptService({ repository, now: () => 1000 });
  await service.generateDraft({ templateId: "ai_reflection", title: "AI 记忆边界", scriptId: "ts_runtime" });
  await repository.approveRevision("ts_runtime", 1, "test");
  return { repository };
}

function fakeStageOutput(intents: OutputIntent[]): StageOutputArbiter {
  return {
    propose: async (intent: OutputIntent) => {
      intents.push(intent);
      return { status: "accepted", outputId: intent.id, reason: "test", intent };
    },
  } as unknown as StageOutputArbiter;
}
