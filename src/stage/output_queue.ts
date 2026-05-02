// === Imports ===
import type { OutputIntent } from "./output_types.js";
import { compareIntentPriority } from "./output_policy.js";
import type { StageQueuedOutputSnapshot } from "./output_types.js";

// === Types ===
export interface DequeueReadyResult {
  intent?: OutputIntent;
  dropped: Array<{ intent: OutputIntent; reason: "expired" }>;
}

// === Main Class ===
export class StageOutputQueue {
  private readonly items: Array<{ intent: OutputIntent & { createdAt: number }; enqueuedAt: number }> = [];

  constructor(
    private readonly maxLength: number,
    private readonly now: () => number,
  ) {}

  enqueue(intent: OutputIntent): {
    status: "accepted" | "merged" | "dropped";
    mergedIntent?: OutputIntent;
    droppedIntents: Array<{ intent: OutputIntent; reason: string }>;
  } {
    const droppedIntents: Array<{ intent: OutputIntent; reason: string }> = [];
    let mergedIntent: OutputIntent | undefined;
    let status: "accepted" | "merged" | "dropped" = "accepted";

    if (intent.mergeKey) {
      const existingIdx = this.items.findIndex((item) => item.intent.mergeKey === intent.mergeKey);
      if (existingIdx >= 0) {
        mergedIntent = this.items.splice(existingIdx, 1)[0].intent;
        status = "merged";
      }
    }

    const createdAt = intent.createdAt ?? this.now();
    this.items.push({ intent: { ...intent, createdAt }, enqueuedAt: this.now() });
    this.items.sort((a, b) => compareIntentPriority(a.intent, b.intent));

    if (this.items.length > this.maxLength) {
      const removed = this.items.splice(this.maxLength);
      for (const item of removed) {
        droppedIntents.push({ intent: item.intent, reason: "queue_overflow_priority" });
        if (item.intent.id === intent.id) {
          status = "dropped";
        }
      }
    }

    return { status, mergedIntent, droppedIntents };
  }

  dequeueReady(): DequeueReadyResult {
    const now = this.now();
    const dropped: Array<{ intent: OutputIntent; reason: "expired" }> = [];
    while (this.items.length > 0) {
      const item = this.items.shift();
      if (!item) return { dropped };
      if (now - item.intent.createdAt <= item.intent.ttlMs) return { intent: item.intent, dropped };
      dropped.push({ intent: item.intent, reason: "expired" });
    }
    return { dropped };
  }

  cancelByCursor(cursorId: string): number {
    const before = this.items.length;
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      if (this.items[i].intent.cursorId === cursorId) this.items.splice(i, 1);
    }
    return before - this.items.length;
  }

  clear(): number {
    const count = this.items.length;
    this.items.splice(0);
    return count;
  }

  length(): number {
    return this.items.length;
  }

  snapshot(): StageQueuedOutputSnapshot[] {
    const now = this.now();
    return this.items.map(({ intent, enqueuedAt }) => ({
      id: intent.id,
      cursorId: intent.cursorId,
      lane: intent.lane,
      groupId: intent.groupId,
      sequence: intent.sequence,
      createdAt: intent.createdAt,
      priority: intent.priority,
      salience: intent.salience,
      text: intent.summary ?? intent.text,
      enqueuedAt,
      ttlMs: intent.ttlMs,
      ttlRemainingMs: Math.max(0, intent.ttlMs - (now - intent.createdAt)),
    }));
  }
}
