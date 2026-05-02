// === Imports ===
import { applyOutputBudget } from "./budget.js";
import { decideOutputPolicy } from "./policy.js";
import { StageOutputQueue } from "./queue.js";
import type {
  OutputIntent,
  StageOutputArbiterDeps,
  StageOutputDecision,
  StageOutputRecord,
  StageOutputState,
} from "./types.js";
import { moderateLiveOutputText } from "../../../utils/live_event.js";
import { BaseArbiter } from "./base_arbiter.js";

// === Main Class ===
export class StageOutputArbiter extends BaseArbiter<OutputIntent, StageOutputDecision, StageOutputState> {
  private readonly queue: StageOutputQueue;
  private readonly recentOutputs: StageOutputRecord[] = [];
  private state: StageOutputState;
  private processing = false;
  private currentAbortController?: AbortController;
  private autoReplyPaused = false;
  private ttsMuted = false;

  constructor(deps: StageOutputArbiterDeps) {
    super("stage_output", deps);
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
      autoReplyPaused: false,
      ttsMuted: false,
    };
  }

  // === Arbitration Logic ===
  async propose(input: OutputIntent): Promise<StageOutputDecision> {
    // 1. Auto-reply Check
    if (this.autoReplyPaused && isAutoReplyIntent(input)) {
      this.record({
        id: input.id,
        cursorId: input.cursorId,
        lane: input.lane,
        text: input.text,
        status: "dropped",
        reason: "auto_reply_paused",
      });
      this.publish("stage.output.dropped", input, { reason: "auto_reply_paused" });
      return { status: "dropped", outputId: input.id, reason: "auto_reply_paused", intent: input };
    }

    // 2. Moderation
    const moderation = moderateLiveOutputText(input.text);
    if (!moderation.allowed && input.lane !== "emergency") {
      this.deps.eventBus?.publish({
        type: "live.moderation.decision" as any,
        source: "stage_output",
        id: `stage-output-moderation-${input.id}`,
        timestamp: this.deps.now(),
        payload: {
          eventId: input.sourceEventId ?? input.id,
          outputId: input.id,
          allowed: false,
          action: moderation.action,
          reason: moderation.reason,
          category: moderation.category,
          visibleToControlRoom: true,
        },
      });
      const safeText = moderation.action === "hide" ? "这条内容我先不展开，我们换个安全一点的话题。" : "";
      if (!safeText) {
        this.record({
          id: input.id,
          cursorId: input.cursorId,
          lane: input.lane,
          text: input.text,
          status: "dropped",
          reason: `output_${moderation.category ?? "moderation"}`,
        });
        this.publish("stage.output.dropped", input, { reason: `output_${moderation.category ?? "moderation"}` });
        return {
          status: "dropped",
          outputId: input.id,
          reason: `output_${moderation.category ?? "moderation"}`,
          intent: input,
        };
      }
      input = { ...input, text: safeText, summary: safeText, output: { ...input.output, tts: input.output.tts } };
    }

    // 3. Budgeting & Preparation
    const intent = applyOutputBudget(this.ttsMuted ? { ...input, output: { ...input.output, tts: false } } : input);
    this.publish("stage.output.received", intent, { reason: "proposed" });

    // 4. Policy Decision
    const now = this.deps.now();
    const policy = decideOutputPolicy({
      intent,
      state: this.state,
      now,
      debugEnabled: Boolean((this.deps as StageOutputArbiterDeps).debugEnabled),
      quietIntervalMs: (this.deps as StageOutputArbiterDeps).quietIntervalMs ?? 6_000,
    });

    // 5. Action Execution
    switch (policy.action) {
      case "drop":
        this.record({
          id: intent.id,
          cursorId: intent.cursorId,
          lane: intent.lane,
          text: intent.text,
          status: "dropped",
          reason: policy.reason,
        });
        this.publish("stage.output.dropped", intent, { reason: policy.reason });
        return { status: "dropped", outputId: intent.id, reason: policy.reason, intent };

      case "queue":
        return this.enqueueIntent(intent, policy.reason);

      case "interrupt":
        if (intent.interrupt === "hard") {
          if (this.state.currentOutputId) {
            this.currentAbortController?.abort();
            this.publish("stage.output.interrupted", intent, { reason: policy.reason });

            await (this.deps as StageOutputArbiterDeps).renderer.stopCurrentOutput().catch((err) => {
              console.error("[StageOutputArbiter] renderer.stopCurrentOutput failed:", err);
            });
          }
          void this.start(intent);
          return { status: "interrupted", outputId: intent.id, reason: policy.reason, intent };
        }
        // Soft interrupt falls back to queue
        return this.enqueueIntent(intent, policy.reason);

      case "accept_now":
      default:
        this.publish("stage.output.accepted", intent, { reason: policy.reason });
        void this.start(intent);
        return { status: "accepted", outputId: intent.id, reason: policy.reason, intent };
    }
  }

  private enqueueIntent(intent: OutputIntent, reason: string): StageOutputDecision {
    const qRes = this.queue.enqueue(intent);
    this.syncQueueLength();
    this.processQueueResults(qRes);

    if (qRes.status === "dropped") {
      return { status: "dropped", outputId: intent.id, reason: "queue_overflow", intent };
    }
    return {
      status: "queued",
      outputId: intent.id,
      reason: qRes.status === "merged" ? "merged" : reason,
      intent,
      queueLength: this.queue.length(),
    };
  }

  private processQueueResults(qRes: ReturnType<StageOutputQueue["enqueue"]>): void {
    if (qRes.mergedIntent) {
      this.record({
        id: qRes.mergedIntent.id,
        cursorId: qRes.mergedIntent.cursorId,
        lane: qRes.mergedIntent.lane,
        text: qRes.mergedIntent.text,
        status: "dropped",
        reason: "merged",
      });
      this.publish("stage.output.dropped", qRes.mergedIntent, { reason: "merged" });
    }
    for (const dropped of qRes.droppedIntents) {
      this.record({
        id: dropped.intent.id,
        cursorId: dropped.intent.cursorId,
        lane: dropped.intent.lane,
        text: dropped.intent.text,
        status: "dropped",
        reason: dropped.reason,
      });
      this.publish("stage.output.dropped", dropped.intent, { reason: dropped.reason });
    }
  }

  // === State Management ===
  cancelByCursor(cursorId: string, reason: string): { cancelled: number; reason: string } {
    const cancelled = this.queue.cancelByCursor(cursorId);
    this.syncQueueLength();
    if (this.state.currentOwner === cursorId) {
      this.currentAbortController?.abort();
    }
    return { cancelled, reason };
  }

  clearQueue(reason = "control_clear_queue"): { cancelled: number; reason: string } {
    const cancelled = this.queue.clear();
    this.syncQueueLength();
    return { cancelled, reason };
  }

  stopCurrent(reason = "control_stop_output"): { stopped: boolean; reason: string } {
    const stopped = Boolean(this.state.currentOutputId);
    this.currentAbortController?.abort();
    void (this.deps as StageOutputArbiterDeps).renderer.stopCurrentOutput().catch((err) => {
      console.error("[StageOutputArbiter] renderer.stopCurrentOutput failed:", err);
    });
    return { stopped, reason };
  }

  setAutoReplyPaused(paused: boolean): { paused: boolean } {
    this.autoReplyPaused = paused;
    this.state = { ...this.state, autoReplyPaused: paused };
    return { paused };
  }

  setTtsMuted(muted: boolean): { muted: boolean } {
    this.ttsMuted = muted;
    this.state = { ...this.state, ttsMuted: muted };
    return { muted };
  }

  snapshot(): StageOutputState {
    return {
      ...this.state,
      queueLength: this.queue.length(),
      recentOutputs: [...this.recentOutputs],
      autoReplyPaused: this.autoReplyPaused,
      ttsMuted: this.ttsMuted,
    };
  }

  // === Execution Logic ===
  private async start(intent: OutputIntent): Promise<void> {
    if (this.processing && intent.interrupt !== "hard") {
      const qRes = this.queue.enqueue(intent);
      this.syncQueueLength();
      this.processQueueResults(qRes);
      return;
    }

    // Cancel previous if any
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

    this.record({
      id: intent.id,
      cursorId: intent.cursorId,
      lane: intent.lane,
      text: intent.text,
      status: "started",
      startedAt: now,
    });
    this.publish("stage.output.started", intent, { reason: "started" });

    try {
      if (signal.aborted) throw new Error("interrupted");

      const startTime = this.deps.now();
      await (this.deps as StageOutputArbiterDeps).renderer.render(intent, signal);

      if (signal.aborted) throw new Error("interrupted");

      // Requirement: Hold speaking/processing until estimatedDurationMs is reached
      const holdMs = intent.estimatedDurationMs ?? 2500;
      const elapsed = this.deps.now() - startTime;
      const remaining = holdMs - elapsed;
      if (remaining > 0) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, remaining);
          const onAbort = () => {
            clearTimeout(timer);
            reject(new Error("interrupted"));
          };
          signal.addEventListener("abort", onAbort, { once: true });
        });
      }

      if (signal.aborted) throw new Error("interrupted");

      const completedAt = this.deps.now();
      this.record({
        id: intent.id,
        cursorId: intent.cursorId,
        lane: intent.lane,
        text: intent.text,
        status: "completed",
        completedAt,
      });
      this.publish("stage.output.completed", intent, { reason: "completed" });
    } catch (error) {
      const isAbort =
        signal.aborted ||
        (error instanceof Error &&
          (error.message === "interrupted" || error.name === "AbortError" || error.name === "CanceledError"));
      const reason = isAbort ? "interrupted" : error instanceof Error ? error.message : String(error);

      this.record({
        id: intent.id,
        cursorId: intent.cursorId,
        lane: intent.lane,
        text: intent.text,
        status: isAbort ? "interrupted" : "dropped",
        reason,
      });
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
    const result = this.queue.dequeueReady();
    for (const dropped of result.dropped) {
      this.record({
        id: dropped.intent.id,
        cursorId: dropped.intent.cursorId,
        lane: dropped.intent.lane,
        text: dropped.intent.text,
        status: "dropped",
        reason: dropped.reason,
      });
      this.publish("stage.output.dropped", dropped.intent, { reason: dropped.reason });
    }
    this.syncQueueLength();
    if (result.intent) void this.start(result.intent);
  }

  // === Record Keeping ===
  private syncQueueLength(): void {
    this.state = { ...this.state, queueLength: this.queue.length() };
  }

  private record(record: StageOutputRecord): void {
    const existingIndex = this.recentOutputs.findIndex((r) => r.id === record.id);
    if (existingIndex >= 0) {
      this.recentOutputs[existingIndex] = { ...this.recentOutputs[existingIndex], ...record };
    } else {
      this.recentOutputs.push(record);
      if (this.recentOutputs.length > 20) this.recentOutputs.shift();
    }
    this.state = { ...this.state, recentOutputs: [...this.recentOutputs] };
  }
}

// === Utilities ===
function isAutoReplyIntent(intent: OutputIntent): boolean {
  // Formal definition: any autonomous response that isn't explicitly urgent or manual.
  // We exclude emergency/debug lanes and high/critical salience to ensure important interactions persist.
  if (intent.lane === "emergency" || intent.lane === "debug") return false;
  if (intent.salience === "critical" || intent.salience === "high") return false;

  // Autonomous lanes: responses to chat, scheduled topics, and ambient filler.
  return (
    intent.lane === "direct_response" ||
    intent.lane === "topic_hosting" ||
    intent.lane === "live_chat" ||
    intent.lane === "ambient"
  );
}
