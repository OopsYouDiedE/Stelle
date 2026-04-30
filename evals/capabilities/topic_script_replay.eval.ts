import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { StageOutputArbiter } from "../../src/actuator/output_arbiter.js";
import type { OutputIntent } from "../../src/stage/output_types.js";
import { TopicScriptRepository } from "../../src/live/controller/topic_script_repository.js";
import { TopicScriptService } from "../../src/live/controller/topic_script_service.js";
import { TopicScriptRuntimeService } from "../../src/live/controller/topic_script_runtime.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";
import { recordEvalCase } from "../utils/report.js";
import { summarizeChecks } from "../utils/scoring.js";

describe("Topic Script Replay Eval", () => {
  it("replays viewer interruption and fallback behavior without LLM", async () => {
    const start = Date.now();
    const eventBus = new StelleEventBus();
    const intents: OutputIntent[] = [];
    const repository = await approvedRepository();
    const runtime = new TopicScriptRuntimeService({
      eventBus,
      repository,
      stageOutput: {
        propose: async (intent: OutputIntent) => {
          intents.push(intent);
          return { status: "accepted", outputId: intent.id, reason: "eval", intent };
        },
      } as unknown as StageOutputArbiter,
      now: () => Date.now(),
    });

    await runtime.start();
    eventBus.publish({
      type: "live.event.received",
      source: "fixture",
      payload: { id: "replay-q1", source: "fixture", cmd: "DANMU_MSG", text: "为什么要记住观众？" },
    });
    await runtime.forceFallback("replay_forced");

    const score = summarizeChecks([
      { ok: intents.some(intent => intent.lane === "topic_hosting"), name: "topic_hosting_started" },
      { ok: intents.some(intent => intent.lane === "direct_response"), name: "direct_response_interruption" },
      { ok: runtime.snapshot().fallbackCount === 1, name: "fallback_count", note: `fallback=${runtime.snapshot().fallbackCount}` },
      { ok: intents.every(intent => intent.cursorId === "topic_script_runtime"), name: "stage_output_only" },
    ]);

    await recordEvalCase({
      suite: "topic_script_replay",
      caseId: "replay_interrupt_and_fallback",
      title: "Replay interruption and fallback without LLM",
      model: "deterministic",
      latencyMs: Date.now() - start,
      input: { events: ["question", "forced_fallback"] },
      output: { runtime: runtime.snapshot(), intents: intents.map(intent => ({ lane: intent.lane, text: intent.text, metadata: intent.metadata })) },
      score,
    });
    expect(score.passed).toBe(true);
  });
});

async function approvedRepository(): Promise<TopicScriptRepository> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "stelle-topic-replay-"));
  const repository = new TopicScriptRepository({ rootDir, now: () => 1000 });
  const service = new TopicScriptService({ repository, now: () => 1000 });
  await service.generateDraft({ templateId: "ai_reflection", scriptId: "ts_replay", title: "AI 记忆边界" });
  await repository.approveRevision("ts_replay", 1, "eval");
  return repository;
}
