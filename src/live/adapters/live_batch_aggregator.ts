// === Imports ===
import type { NormalizedLiveEvent } from "../../utils/live_event.js";

// === Types ===
export interface LiveBatchAggregatorPolicy {
  flushIntervalMs: number;
  maxWaitMs: number;
  urgentDelayMs: number;
  maxBatchSize: number;
  maxBufferSize: number;
}

export type DropReason = "buffer_overflow" | "expired" | "moderation_rejected" | "duplicate" | "noise_filtered";

export type FlushReason = "timer" | "urgent" | "max_batch_size" | "max_wait" | "drain";

// === Main Class ===
export class LiveBatchAggregator {
  private buffer: NormalizedLiveEvent[] = [];
  private timer?: NodeJS.Timeout;
  private timerDueAt = 0;
  private firstBufferedAt = 0;

  constructor(
    private readonly policy: LiveBatchAggregatorPolicy,
    private readonly now: () => number,
    private readonly onFlush: (batch: NormalizedLiveEvent[], reason: FlushReason) => void,
    private readonly onDrop: (event: NormalizedLiveEvent, reason: DropReason) => void,
  ) {}

  // --- Buffer Management ---
  push(event: NormalizedLiveEvent): void {
    const t = this.now();
    const accepted = this.acceptWithOverflow(event);
    if (!accepted) return;

    if (this.buffer.length === 1) {
      this.firstBufferedAt = t;
    }

    if (this.isUrgent(event)) {
      this.ensureTimer(this.policy.urgentDelayMs, "urgent");
      return;
    }

    if (this.buffer.length >= this.policy.maxBatchSize) {
      this.flush("max_batch_size");
      return;
    }

    const age = t - this.firstBufferedAt;
    if (age >= this.policy.maxWaitMs) {
      this.flush("max_wait");
      return;
    }

    this.ensureTimer(Math.min(this.policy.flushIntervalMs, this.policy.maxWaitMs - age), "timer");
  }

  flush(reason: FlushReason = "drain"): void {
    this.clearTimer();
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0, this.policy.maxBatchSize);
    this.onFlush(batch, reason);

    if (this.buffer.length > 0) {
      this.firstBufferedAt = this.now();
      this.ensureTimer(0, "drain");
    }
  }

  clear(): void {
    this.clearTimer();
    this.buffer = [];
    this.firstBufferedAt = 0;
  }

  getBufferSize(): number {
    return this.buffer.length;
  }

  private acceptWithOverflow(incoming: NormalizedLiveEvent): boolean {
    if (this.buffer.length < this.policy.maxBufferSize) {
      this.buffer.push(incoming);
      return true;
    }

    const all = [...this.buffer, incoming].sort((a, b) => {
      const priorityDelta = priorityScore(a) - priorityScore(b);
      if (priorityDelta !== 0) return priorityDelta;
      return a.receivedAt - b.receivedAt;
    });
    const dropped = all.shift();
    this.buffer = all;
    if (dropped) this.onDrop(dropped, "buffer_overflow");
    return dropped?.id !== incoming.id;
  }

  // --- Timer Logic ---
  private ensureTimer(delayMs: number, reason: FlushReason): void {
    const dueAt = this.now() + Math.max(0, delayMs);
    if (this.timer && this.timerDueAt <= dueAt) return;

    this.clearTimer();
    this.timerDueAt = dueAt;
    this.timer = setTimeout(
      () => {
        this.flush(reason);
      },
      Math.max(0, delayMs),
    );
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.timerDueAt = 0;
  }

  private isUrgent(event: NormalizedLiveEvent): boolean {
    return event.kind === "super_chat" || event.kind === "guard" || event.kind === "gift" || event.priority === "high";
  }
}

// === Helpers ===
function priorityScore(event: NormalizedLiveEvent): number {
  if (event.priority === "high") return 3;
  if (event.priority === "medium") return 2;
  return 1;
}
