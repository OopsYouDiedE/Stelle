import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { StageOutputArbiter } from "../../src/actuator/output_arbiter.js";
import type { OutputIntent } from "../../src/stage/output_types.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";
import { TopicScriptRepository } from "../../src/live/controller/topic_script_repository.js";
import { TopicScriptService } from "../../src/live/controller/topic_script_service.js";
import { TopicScriptRuntimeService } from "../../src/live/controller/topic_script_runtime.js";

describe("topic script runtime", () => {
  it("stays idle without output when no approved script exists", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "stelle-topic-runtime-empty-"));
    const intents: OutputIntent[] = [];
    const runtime = new TopicScriptRuntimeService({
      eventBus: new StelleEventBus(),
      repository: new TopicScriptRepository({ rootDir, now: () => 1000 }),
      stageOutput: fakeStageOutput(intents),
      now: () => 1000,
    });

    await runtime.start();

    expect(runtime.snapshot().status).toBe("idle");
    expect(intents).toHaveLength(0);
  });

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

  it("prefills topic hosting lines so the stage has a speaking buffer", async () => {
    const { repository } = await approvedRepository();
    const intents: OutputIntent[] = [];
    const runtime = new TopicScriptRuntimeService({
      eventBus: new StelleEventBus(),
      repository,
      stageOutput: fakeStageOutput(intents),
      now: () => 1000,
    });

    await runtime.start();

    expect(intents.length).toBeGreaterThan(1);
    expect(intents.some((intent) => intent.metadata?.source === "section_buffer")).toBe(true);
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

  it("advances sections on live ticks after the section duration elapses", async () => {
    const { repository } = await approvedRepository();
    const eventBus = new StelleEventBus();
    const intents: OutputIntent[] = [];
    let now = 1000;
    const runtime = new TopicScriptRuntimeService({
      eventBus,
      repository,
      stageOutput: fakeStageOutput(intents),
      now: () => now,
    });
    await runtime.start();

    now += 200_000;
    eventBus.publish({
      type: "live.tick",
      source: "fixture",
      reason: "test_live_tick",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.snapshot().sectionIndex).toBe(1);
    expect(intents.some((intent) => intent.cursorId === "topic_script_runtime")).toBe(true);
    expect(intents.some((intent) => intent.metadata?.section_id === "sampling_2")).toBe(true);
  });

  it("replenishes topic hosting lines on live ticks before a section ends", async () => {
    const { repository } = await approvedRepository();
    const eventBus = new StelleEventBus();
    const intents: OutputIntent[] = [];
    let now = 1000;
    const runtime = new TopicScriptRuntimeService({
      eventBus,
      repository,
      stageOutput: fakeStageOutput(intents),
      now: () => now,
    });
    await runtime.start();
    const before = intents.length;

    now += 36_000;
    eventBus.publish({
      type: "live.tick",
      source: "fixture",
      reason: "test_live_tick",
    });
    await Promise.resolve();

    expect(runtime.snapshot().sectionIndex).toBe(0);
    expect(intents.length).toBeGreaterThan(before);
    expect(intents.at(-1)?.metadata?.source).toBe("section_beat");
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
    snapshot: () => ({
      id: "stage_output",
      status: "idle",
      speaking: false,
      captionBusyUntil: 0,
      ttsBusyUntil: 0,
      motionBusyUntil: 0,
      queueLength: 0,
      recentOutputs: [],
    }),
  } as unknown as StageOutputArbiter;
}
