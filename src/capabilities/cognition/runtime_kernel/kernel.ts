import type { PerceptualEvent } from "../../../core/protocol/perceptual_event.js";
import type { Intent } from "../../../core/protocol/intent.js";
import type { ExecutionResult } from "../../../core/protocol/execution.js";
import type { RuntimeKernelState } from "./state.js";
import { createInitialState } from "./state.js";
import type { RuntimeKernelPipeline } from "./pipeline.js";
import type { KernelDecision, RuntimeKernelSnapshot } from "./types.js";

export class RuntimeKernel {
  private state: RuntimeKernelState;
  private lastDecision?: KernelDecision;

  constructor(private pipeline: RuntimeKernelPipeline) {
    this.state = createInitialState();
  }

  async step(event: PerceptualEvent): Promise<KernelDecision[]> {
    this.state.recentEventIds.push(event.id);
    if (this.state.recentEventIds.length > 50) this.state.recentEventIds.shift();

    let enriched: PerceptualEvent;
    let attention;
    try {
      enriched = await this.pipeline.enrich(event, this.state);
      attention = await this.pipeline.evaluateAttention(enriched, this.state);
    } catch (error) {
      return this.safeFallback(event.id, error, "Kernel enrichment or attention stage failed");
    }

    if (!attention.accepted) {
      const decision: KernelDecision = {
        kind: "ignored",
        reason: attention.reason,
        sourceEventIds: [event.id],
      };
      this.lastDecision = decision;
      return [decision];
    }

    let intents;
    try {
      intents = await this.pipeline.plan(enriched, this.state);
    } catch (error) {
      return this.safeFallback(event.id, error, "Kernel planning stage failed");
    }
    const decisions: KernelDecision[] = intents.map((intent) => ({
      kind: "intent",
      intent: this.state.stageBusy ? { ...intent, metadata: { ...intent.metadata, delayed: true } } : intent,
      reason: this.state.stageBusy ? "Stage is busy; intent is marked for delayed delivery" : intent.reason,
    }));

    if (this.state.stageBusy) {
      this.state.queuedIntentIds.push(...intents.map((intent) => intent.id));
    }

    if (decisions.length > 0) {
      this.lastDecision = decisions[decisions.length - 1];
    }

    return decisions;
  }

  async tick(): Promise<KernelDecision[]> {
    this.state.lastTickTimestamp = Date.now();
    const intents = await this.pipeline.planTick?.(this.state);
    const decisions: KernelDecision[] = intents?.map((intent) => ({
      kind: "intent",
      intent,
      reason: intent.reason,
    })) ?? [
      {
        kind: "state_updated",
        reason: "Kernel heartbeat tick recorded with no proactive intent",
        sourceEventIds: [],
      },
    ];
    this.lastDecision = decisions[decisions.length - 1];
    return decisions;
  }

  async onExecutionResult(result: ExecutionResult): Promise<void> {
    if (result.status === "failed") {
      this.state.counters.executionFailures = (this.state.counters.executionFailures ?? 0) + 1;
    }
    if (result.metadata?.stageBusy === true) {
      this.state.stageBusy = true;
    }
    if (result.metadata?.stageBusy === false || result.status === "completed") {
      this.state.stageBusy = false;
      this.state.queuedIntentIds = [];
    }
  }

  snapshot(): RuntimeKernelSnapshot {
    return {
      state: { ...this.state },
      activeIntents: [], // Map from intent registry in a real implementation
      lastDecision: this.lastDecision,
    };
  }

  hydrate(snapshot: RuntimeKernelSnapshot): void {
    this.state = snapshot.state;
    this.lastDecision = snapshot.lastDecision;
  }

  private safeFallback(sourceEventId: string, error: unknown, reason: string): KernelDecision[] {
    const decision: KernelDecision = {
      kind: "intent",
      reason,
      intent: {
        id: `intent_fallback_${Date.now()}`,
        type: "respond",
        sourcePackageId: "capability.cognition.runtime_kernel",
        priority: 1,
        createdAt: Date.now(),
        reason: `${reason}: ${error instanceof Error ? error.message : String(error)}`,
        sourceEventIds: [sourceEventId],
        payload: { text: "我这边刚才有点卡住了，先稳住，我们继续。", fallback: true },
      },
    };
    this.lastDecision = decision;
    return [decision];
  }
}
