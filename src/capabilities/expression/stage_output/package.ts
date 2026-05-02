import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../../core/protocol/component.js";
import { StageOutputArbiter } from "./arbiter.js";
import { createStageOutputDebugProvider } from "./debug_provider.js";
import type { RuntimeConfig } from "../../../config/index.js";
import type { Intent } from "../../../core/protocol/intent.js";
import type { OutputIntent, StageOutputRenderer } from "./types.js";

let unsubscribes: Array<() => void> = [];

class NullStageOutputRenderer implements StageOutputRenderer {
  async render(): Promise<void> {
    return undefined;
  }

  async stopCurrentOutput(): Promise<void> {
    return undefined;
  }
}

export const stageOutputCapability: ComponentPackage = {
  id: "capability.expression.stage_output",
  kind: "capability",
  version: "1.0.0",
  displayName: "Stage Output",

  provides: [
    { id: "expression.stage_output", kind: "service" },
    { id: "expression.stage_output.debug", kind: "debug_provider" },
  ],

  register(ctx: ComponentRegisterContext) {
    const config = ctx.config as RuntimeConfig;
    const renderer =
      ctx.registry.resolve<StageOutputRenderer>("expression.stage_renderer") ?? new NullStageOutputRenderer();

    const arbiter = new StageOutputArbiter({
      renderer,
      eventBus: ctx.events as never,
      now: () => Date.now(),
      debugEnabled: Boolean(config.debug?.enabled),
      maxQueueLength: config.live?.speechQueueLimit || 5,
    });

    ctx.registry.provideForPackage?.(stageOutputCapability.id, "expression.stage_output", arbiter) ??
      ctx.registry.provide("expression.stage_output", arbiter);
    ctx.registry.provideDebugProvider(createStageOutputDebugProvider(arbiter));
  },

  async start(ctx: ComponentRuntimeContext) {
    const arbiter = ctx.registry.resolve<StageOutputArbiter>("expression.stage_output");
    unsubscribes.push(
      ctx.events.subscribe("cognition.intent", (event) => {
        const payload = asRecord(event).payload;
        const intent = isIntent(payload) ? payload : undefined;
        if (intent?.type !== "respond") return;
        void arbiter?.propose(toStageOutputIntent(intent)).catch((error) => {
          ctx.logger.error("Stage Output failed to accept cognition intent", error);
        });
      }),
    );
    unsubscribes.push(
      ctx.events.subscribe("program.output.proposal", (event) => {
        const proposal = asRecord(asRecord(event).payload);
        const outputIntent = isOutputIntent(proposal.intent) ? proposal.intent : toOutputIntent(proposal.intent);
        if (!outputIntent) return;
        void arbiter?.propose(outputIntent).catch((error) => {
          ctx.logger.error("Stage Output failed to accept program output proposal", error);
        });
      }),
    );
    ctx.logger.info("Stage Output Capability started");
  },

  async stop(ctx: ComponentRuntimeContext) {
    for (const unsubscribe of unsubscribes) unsubscribe();
    unsubscribes = [];
    ctx.logger.info("Stage Output Capability stopped");
  },
};

function toStageOutputIntent(intent: Intent): OutputIntent {
  const payload = (intent.payload ?? {}) as Partial<OutputIntent> & { text?: string; sourceWindow?: string };
  return {
    id: payload.id ?? intent.id,
    cursorId: payload.cursorId ?? payload.sourceWindow ?? intent.sourcePackageId,
    sourceEventId: payload.sourceEventId ?? intent.sourceEventIds?.[0],
    lane: payload.lane ?? "direct_response",
    priority: payload.priority ?? intent.priority,
    salience: payload.salience ?? "medium",
    text: payload.text ?? "",
    ttlMs: payload.ttlMs ?? 30_000,
    interrupt: payload.interrupt ?? "soft",
    output: payload.output ?? { caption: true, tts: true },
    metadata: payload.metadata,
  };
}

function isIntent(value: unknown): value is Intent {
  const record = asRecord(value);
  return typeof record.id === "string" && typeof record.type === "string" && typeof record.sourcePackageId === "string";
}

function isOutputIntent(value: unknown): value is OutputIntent {
  const record = asRecord(value);
  return (
    typeof record.id === "string" &&
    typeof record.cursorId === "string" &&
    typeof record.lane === "string" &&
    typeof record.text === "string" &&
    typeof record.output === "object"
  );
}

function toOutputIntent(value: unknown): OutputIntent | undefined {
  const record = asRecord(value);
  const text = typeof record.text === "string" ? record.text : undefined;
  if (!text) return undefined;
  return {
    id:
      typeof record.id === "string"
        ? record.id
        : `program-output-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    cursorId: typeof record.cursorId === "string" ? record.cursorId : "program",
    sourceEventId: typeof record.sourceEventId === "string" ? record.sourceEventId : undefined,
    lane: typeof record.lane === "string" ? (record.lane as OutputIntent["lane"]) : "topic_hosting",
    priority: typeof record.priority === "number" ? record.priority : 40,
    salience: typeof record.salience === "string" ? (record.salience as OutputIntent["salience"]) : "medium",
    text,
    summary: typeof record.summary === "string" ? record.summary : text,
    topic: typeof record.topic === "string" ? record.topic : undefined,
    ttlMs: typeof record.ttlMs === "number" ? record.ttlMs : 20_000,
    interrupt: typeof record.interrupt === "string" ? (record.interrupt as OutputIntent["interrupt"]) : "none",
    output: asRecord(record.output) as OutputIntent["output"],
    metadata: asRecord(record.metadata),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
