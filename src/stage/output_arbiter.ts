import { applyOutputBudget } from "./output_budget.js";
import { decideOutputPolicy } from "./output_policy.js";
import { StageOutputQueue } from "./output_queue.js";
import type { OutputIntent, StageOutputArbiterDeps, StageOutputDecision, StageOutputRecord, StageOutputState } from "./output_types.js";

export class StageOutputArbiter {
  private readonly queue: StageOutputQueue;
  private readonly recentOutputs: StageOutputRecord[] = [];
  private state: StageOutputState;
  private processing = false;

  constructor(private readonly deps: StageOutputArbiterDeps) {
    this.queue = new StageOutputQueue(deps.maxQueueLength ?? 5, deps.now);
    this.state = {
      id: "stage_output",
      status: "idle",
      speaking: false,
      captionBusyUntil: 0,
      ttsBusyUntil: 0,
      motionBusyUntil: 0,
      queueLength: 0,
      recentOutputs: [],
    };
  }

  async propose(input: OutputIntent): Promise<StageOutputDecision> {
    const intent = applyOutputBudget(input);
    this.publish("cursor.output.propose", intent, { reason: "proposed" });

    const now = this.deps.now();
    const policy = decideOutputPolicy({
      intent,
      state: this.state,
      now,
      debugEnabled: Boolean(this.deps.debugEnabled),
      quietIntervalMs: this.deps.quietIntervalMs ?? 6_000,
    });

    if (policy.action === "drop") {
      this.record({ id: intent.id, cursorId: intent.cursorId, lane: intent.lane, text: intent.text, status: "dropped", reason: policy.reason });
      this.publish("stage.output.dropped", intent, { reason: policy.reason });
      return { status: "dropped", outputId: intent.id, reason: policy.reason, intent };
    }

    if (policy.action === "queue") {
      this.queue.enqueue(intent);
      this.syncQueueLength();
      this.publish("stage.output.queued", intent, { reason: policy.reason });
      return { status: "queued", outputId: intent.id, reason: policy.reason, intent, queueLength: this.queue.length() };
    }

    if (policy.action === "interrupt") {
      if (this.state.currentOutputId) {
        this.record({
          id: this.state.currentOutputId,
          cursorId: this.state.currentOwner ?? "unknown",
          lane: this.state.currentLane ?? "debug",
          text: "",
          status: "interrupted",
          reason: policy.reason,
        });
        this.publish("stage.output.interrupted", intent, { reason: policy.reason });
      }
      await this.start(intent);
      return { status: "interrupted", outputId: intent.id, reason: policy.reason, intent };
    }

    this.publish("stage.output.accepted", intent, { reason: policy.reason });
    await this.start(intent);
    return { status: "accepted", outputId: intent.id, reason: policy.reason, intent };
  }

  cancelByCursor(cursorId: string, reason: string): { cancelled: number; reason: string } {
    const cancelled = this.queue.cancelByCursor(cursorId);
    this.syncQueueLength();
    return { cancelled, reason };
  }

  snapshot(): StageOutputState {
    return {
      ...this.state,
      queueLength: this.queue.length(),
      recentOutputs: [...this.recentOutputs],
    };
  }

  private async start(intent: OutputIntent): Promise<void> {
    if (this.processing && intent.interrupt !== "hard") {
      this.queue.enqueue(intent);
      this.syncQueueLength();
      return;
    }

    this.processing = true;
    const now = this.deps.now();
    this.state = {
      ...this.state,
      status: "speaking",
      speaking: true,
      currentOutputId: intent.id,
      currentOwner: intent.cursorId,
      currentLane: intent.lane,
      currentTopic: intent.topic,
      captionBusyUntil: now + (intent.estimatedDurationMs ?? 2_500),
      ttsBusyUntil: now + (intent.estimatedDurationMs ?? 2_500),
      motionBusyUntil: now + 1_500,
      queueLength: this.queue.length(),
    };

    this.record({ id: intent.id, cursorId: intent.cursorId, lane: intent.lane, text: intent.text, status: "started", startedAt: now });
    this.publish("stage.output.started", intent, { reason: "started" });

    try {
      await this.deps.renderer.render(intent);
      const completedAt = this.deps.now();
      this.record({ id: intent.id, cursorId: intent.cursorId, lane: intent.lane, text: intent.text, status: "completed", completedAt });
      this.publish("stage.output.completed", intent, { reason: "completed" });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.record({ id: intent.id, cursorId: intent.cursorId, lane: intent.lane, text: intent.text, status: "dropped", reason });
      this.publish("stage.output.dropped", intent, { reason });
    } finally {
      this.state = {
        ...this.state,
        status: this.queue.length() > 0 ? "queued" : "idle",
        speaking: false,
        currentOutputId: undefined,
        currentOwner: undefined,
        currentLane: undefined,
        currentTopic: undefined,
        queueLength: this.queue.length(),
      };
      this.processing = false;
      this.drain();
    }
  }

  private drain(): void {
    if (this.processing) return;
    const next = this.queue.dequeueReady();
    this.syncQueueLength();
    if (next) void this.start(next);
  }

  private syncQueueLength(): void {
    this.state = { ...this.state, queueLength: this.queue.length() };
  }

  private record(record: StageOutputRecord): void {
    this.recentOutputs.push(record);
    if (this.recentOutputs.length > 20) this.recentOutputs.shift();
    this.state = { ...this.state, recentOutputs: [...this.recentOutputs] };
  }

  private publish(type: string, intent: OutputIntent, extra: { reason: string }): void {
    this.deps.eventBus?.publish({
      type: type as any,
      source: "stage_output",
      id: `${type}-${intent.id}`,
      timestamp: this.deps.now(),
      payload: { intent, ...extra },
    } as any);
  }
}
