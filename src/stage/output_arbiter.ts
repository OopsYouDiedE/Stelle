import { applyOutputBudget } from "./output_budget.js";
import { decideOutputPolicy } from "./output_policy.js";
import { StageOutputQueue } from "./output_queue.js";
import type { OutputIntent, StageOutputArbiterDeps, StageOutputDecision, StageOutputRecord, StageOutputState } from "./output_types.js";

export class StageOutputArbiter {
  private readonly queue: StageOutputQueue;
  private readonly recentOutputs: StageOutputRecord[] = [];
  private state: StageOutputState;
  private processing = false;
  private currentAbortController?: AbortController;

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
    this.publish("stage.output.received", intent, { reason: "proposed" });

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
      const qRes = this.queue.enqueue(intent);
      this.syncQueueLength();
      if (qRes.status === "dropped") {
        this.record({ id: intent.id, cursorId: intent.cursorId, lane: intent.lane, text: intent.text, status: "dropped", reason: qRes.reason });
        this.publish("stage.output.dropped", intent, { reason: qRes.reason || "queue_overflow" });
        return { status: "dropped", outputId: intent.id, reason: qRes.reason || "queue_overflow", intent };
      }
      if (qRes.status === "merged") {
        this.publish("stage.output.queued", intent, { reason: "merged" });
        return { status: "queued", outputId: intent.id, reason: "merged", intent, queueLength: this.queue.length() };
      }
      this.publish("stage.output.queued", intent, { reason: policy.reason });
      return { status: "queued", outputId: intent.id, reason: policy.reason, intent, queueLength: this.queue.length() };
    }

    if (policy.action === "interrupt") {
      const isHard = intent.interrupt === "hard";
      
      if (isHard) {
        if (this.state.currentOutputId) {
          this.currentAbortController?.abort();
          this.publish("stage.output.interrupted", intent, { reason: policy.reason });
          
          // Requirement: must await stop_output BEFORE starting new output
          const stopTool = this.deps.toolRegistry?.get("live.stop_output");
          if (stopTool) {
            await stopTool.execute({}, { caller: "stage_renderer", cwd: ".", allowedAuthority: ["external_write"] });
          }
        }
        void this.start(intent);
        return { status: "interrupted", outputId: intent.id, reason: policy.reason, intent };
      } else {
        const qRes = this.queue.enqueue(intent);
        this.syncQueueLength();
        if (qRes.status === "dropped") {
          this.record({ id: intent.id, cursorId: intent.cursorId, lane: intent.lane, text: intent.text, status: "dropped", reason: qRes.reason });
          this.publish("stage.output.dropped", intent, { reason: qRes.reason || "queue_overflow" });
          return { status: "dropped", outputId: intent.id, reason: qRes.reason || "queue_overflow", intent };
        }
        this.publish("stage.output.queued", intent, { reason: policy.reason });
        return { status: "queued", outputId: intent.id, reason: policy.reason, intent, queueLength: this.queue.length() };
      }
    }

    this.publish("stage.output.accepted", intent, { reason: policy.reason });
    void this.start(intent);
    return { status: "accepted", outputId: intent.id, reason: policy.reason, intent };
  }

  cancelByCursor(cursorId: string, reason: string): { cancelled: number; reason: string } {
    const cancelled = this.queue.cancelByCursor(cursorId);
    this.syncQueueLength();
    if (this.state.currentOwner === cursorId) {
      this.currentAbortController?.abort();
    }
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

    // Cancel previous if any (should already be handled in propose for interrupt, but for safety)
    if (this.processing && intent.interrupt === "hard") {
      this.currentAbortController?.abort();
    }

    this.processing = true;
    const abortController = new AbortController();
    this.currentAbortController = abortController;
    const signal = abortController.signal;

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
      if (signal.aborted) throw new Error("interrupted");
      
      const startTime = this.deps.now();
      await this.deps.renderer.render(intent, signal);
      
      if (signal.aborted) throw new Error("interrupted");

      // Requirement: Hold speaking/processing until estimatedDuration is reached
      if (intent.estimatedDuration > 0) {
        const elapsed = this.deps.now() - startTime;
        const remaining = intent.estimatedDuration - elapsed;
        if (remaining > 0) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, remaining);
            signal.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new Error("interrupted"));
            });
          });
        }
      }

      if (signal.aborted) throw new Error("interrupted");

      const completedAt = this.deps.now();
      this.record({ id: intent.id, cursorId: intent.cursorId, lane: intent.lane, text: intent.text, status: "completed", completedAt });
      this.publish("stage.output.completed", intent, { reason: "completed" });
    } catch (error) {
      const isAbort = signal.aborted || (error instanceof Error && (error.message === "interrupted" || error.name === "AbortError" || error.name === "CanceledError"));
      const reason = isAbort ? "interrupted" : (error instanceof Error ? error.message : String(error));
      
      this.record({ id: intent.id, cursorId: intent.cursorId, lane: intent.lane, text: intent.text, status: isAbort ? "interrupted" : "dropped", reason });
      this.publish(isAbort ? "stage.output.interrupted" : "stage.output.dropped", intent, { reason });
    } finally {
      if (this.currentAbortController === abortController) {
        this.currentAbortController = undefined;
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
    const existingIndex = this.recentOutputs.findIndex(r => r.id === record.id);
    if (existingIndex >= 0) {
      this.recentOutputs[existingIndex] = { ...this.recentOutputs[existingIndex], ...record };
    } else {
      this.recentOutputs.push(record);
      if (this.recentOutputs.length > 20) this.recentOutputs.shift();
    }
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
