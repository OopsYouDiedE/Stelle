import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OutputIntent } from "../../../../src/capabilities/expression/stage_output/types.js";
import { StelleEventBus } from "../../../../src/core/event/event_bus.js";
import { TopicScriptRepository } from "../../../../src/capabilities/program/topic_script/repository.js";
import { TopicScriptService } from "../../../../src/capabilities/program/topic_script/topic_script_service.js";
import { TopicScriptRuntimeService } from "../../../../src/capabilities/program/topic_script/runtime.js";

describe("topic script runtime", () => {
  it("stays idle without output when no approved script exists", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "stelle-topic-runtime-empty-"));
    const intents: OutputIntent[] = [];
    const eventBus = new StelleEventBus();
    captureOutputProposals(eventBus, intents);
    const runtime = new TopicScriptRuntimeService({
      eventBus,
      repository: new TopicScriptRepository({ rootDir, now: () => 1000 }),
      now: () => 1000,
    });

    await runtime.start();

    expect(runtime.snapshot().status).toBe("idle");
    expect(intents).toHaveLength(0);
  });

  it("loads the latest approved script and proposes the first section through StageOutput", async () => {
    const { repository } = await approvedRepository();
    const intents: OutputIntent[] = [];
    const eventBus = new StelleEventBus();
    captureOutputProposals(eventBus, intents);
    const runtime = new TopicScriptRuntimeService({
      eventBus,
      repository,
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
    captureOutputProposals(eventBus, intents);
    const runtime = new TopicScriptRuntimeService({
      eventBus,
      repository,
      now: () => 1000,
    });
    await runtime.start();

    eventBus.publish({
      type: "program.interaction.received",
      source: "fixture",
      payload: { id: "q1", source: "fixture", cmd: "DANMU_MSG", text: "为什么要记住观众？" },
    });
    await Promise.resolve();

    expect(intents.some((intent) => intent.lane === "direct_response" && intent.text.includes("为什么"))).toBe(true);
    expect(intents.find((intent) => intent.lane === "direct_response")).toMatchObject({
      cursorId: "topic_script_runtime",
      priority: 72,
      interrupt: "soft",
      metadata: expect.objectContaining({
        source: "viewer_interrupt",
        section_id: "opening_1",
      }),
    });
    expect(runtime.snapshot().interruptedCount).toBe(1);
  });

  it("does not advance the Markdown section when an interrupt response completes before section duration", async () => {
    const { repository } = await approvedRepository();
    const eventBus = new StelleEventBus();
    const intents: OutputIntent[] = [];
    captureOutputProposals(eventBus, intents);
    const runtime = new TopicScriptRuntimeService({
      eventBus,
      repository,
      now: () => 1000,
    });
    await runtime.start();

    eventBus.publish({
      type: "program.interaction.received",
      source: "fixture",
      payload: { id: "q1", source: "fixture", cmd: "DANMU_MSG", text: "为什么要记住观众？" },
    });
    await Promise.resolve();
    const interruptIntent = intents.find((intent) => intent.lane === "direct_response");

    eventBus.publish({
      type: "stage.output.completed",
      source: "fixture",
      payload: { intent: interruptIntent },
    });
    await Promise.resolve();

    expect(runtime.snapshot()).toMatchObject({
      status: "running",
      sectionId: "opening_1",
      sectionIndex: 0,
    });
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

function captureOutputProposals(eventBus: StelleEventBus, intents: OutputIntent[]): void {
  eventBus.subscribe("program.output.proposal", (event) => {
    const payload = event.payload as { intent?: OutputIntent };
    if (payload.intent) intents.push(payload.intent);
  });
}
