import { describe, expect, it } from "vitest";
import { InnerCursor } from "../../src/cursor/inner/cursor.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";
import { hasEvalLlmKeys, evalModelLabel, makeEvalLlm, makeEvalModelConfig } from "../utils/env.js";
import { loadEvalCases } from "../utils/dataset.js";
import { recordEvalCase } from "../utils/report.js";
import { forbiddenStrings, maybeAssertScore, summarizeChecks } from "../utils/scoring.js";

describe.skipIf(!hasEvalLlmKeys())("Inner Synthesis Capability Eval", () => {
  it("scores research topics, directives, and self-state restraint", async () => {
    const cases = await loadEvalCases("inner_synthesis.smoke.jsonl");

    for (const evalCase of cases) {
      const start = Date.now();
      const harness = createInnerHarness();
      const inner = new InnerCursor(harness.context as any);
      await inner.initialize();

      const signals = Array.isArray(evalCase.input.signals) ? evalCase.input.signals : [];
      for (const [index, signal] of signals.entries()) {
        inner.receiveDispatch({
          type: "cursor.reflection",
          source: String(asRecord(signal).source || "system") as any,
          id: `${evalCase.id}-${index}`,
          timestamp: harness.now + index,
          payload: {
            intent: String(asRecord(signal).intent || asRecord(signal).kind || "observe"),
            summary: String(asRecord(signal).summary || ""),
            impactScore: Number(asRecord(signal).impactScore || 1),
            salience: enumString(asRecord(signal).salience, ["low", "medium", "high"], "low"),
          },
        });
      }

      await inner.triggerCognitiveSynthesis();
      const snapshot = inner.snapshot();
      const directives = harness.eventBus.getHistory().filter(event => event.type === "cursor.directive");
      const writes = harness.toolWrites;
      const output = { snapshot, directives, writes };

      const topicCount = Number(snapshot.state.activeResearchTopicsCount || 0);
      const score = summarizeChecks([
        {
          ok: !evalCase.expected.shouldCreateResearchTopic || topicCount > 0,
          name: "research_topic_created",
          note: `topicCount=${topicCount}`,
        },
        {
          ok: !evalCase.expected.shouldEmitDirective || directives.some(event => Number(event.payload.expiresAt || 0) > harness.now),
          name: "directive_with_expiry",
          note: `directives=${directives.length}`,
        },
        {
          ok: !writes.some(write => write.layer === "core_identity"),
          name: "no_core_identity_overwrite",
        },
        {
          ok: writes.every(write => ["self_state", "research_logs", undefined].includes(write.layer)),
          name: "allowed_memory_layers",
          note: `layers=${writes.map(write => write.layer).join(",")}`,
        },
        forbiddenStrings(JSON.stringify(output), evalCase.expected.forbiddenStrings, "inner_output"),
      ]);

      expect(snapshot.id).toBe("inner");
      maybeAssertScore(score, 0.75);
      await recordEvalCase({
        suite: "inner_synthesis",
        caseId: evalCase.id,
        title: evalCase.title,
        model: evalModelLabel(),
        latencyMs: Date.now() - start,
        input: evalCase.input,
        output,
        score,
      });

      await inner.stop();
    }
  }, 240000);
});

function createInnerHarness() {
  const now = Date.now();
  const eventBus = new StelleEventBus();
  const longTerm = new Map<string, string>();
  const researchLogs: string[] = [];
  const toolWrites: Array<{ key: string; value: string; layer?: string }> = [];

  const memory = {
    async readLongTerm(key: string, layer = "self_state") {
      return longTerm.get(`${layer}:${key}`) ?? null;
    },
    async writeLongTerm(key: string, value: string, layer = "self_state") {
      longTerm.set(`${layer}:${key}`, value);
    },
    async appendResearchLog(log: { focus: string; process: string[]; conclusion: string }) {
      const entry = `${log.focus}\n${log.process.join("\n")}\n${log.conclusion}`;
      researchLogs.push(entry);
      return `research-${researchLogs.length}`;
    },
    async readResearchLogs(limit = 6) {
      return researchLogs.slice(-limit);
    },
    async readRecent() {
      return [];
    },
  };

  const tools = {
    async execute(name: string, input: Record<string, unknown>) {
      if (name === "memory.write_long_term") {
        const key = String(input.key || "");
        const value = String(input.value || "");
        const layer = input.layer ? String(input.layer) : undefined;
        toolWrites.push({ key, value, layer });
        if (layer) longTerm.set(`${layer}:${key}`, value);
      }
      return { ok: true, summary: "ok" };
    },
  };

  const context = {
    llm: makeEvalLlm(),
    tools,
    config: {
      models: makeEvalModelConfig(),
      discord: { ambientEnabled: true, maxReplyChars: 900, cooldownSeconds: 0 },
      live: { rendererHost: "127.0.0.1", rendererPort: 8787, ttsEnabled: false, obsControlEnabled: false, speechQueueLimit: 5 },
      browser: { enabled: false },
      core: { reflectionIntervalHours: 6, reflectionAccumulationThreshold: 2 },
      debug: { enabled: false, requireToken: true, allowExternalWrite: false },
      control: { requireToken: true },
      rawYaml: {},
    },
    memory,
    eventBus,
    stageOutput: { propose: async () => ({ status: "accepted" }) },
    deviceAction: undefined,
    now: () => now,
  };

  return { context, eventBus, toolWrites, now };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function enumString<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}
