import type { OutputIntent } from "./output_types.js";
import { compareIntentPriority } from "./output_policy.js";

export class StageOutputQueue {
  private readonly items: Array<{ intent: OutputIntent; enqueuedAt: number }> = [];

  constructor(private readonly maxLength: number, private readonly now: () => number) {}

  enqueue(intent: OutputIntent): { 
    status: "accepted" | "merged" | "dropped"; 
    mergedIntent?: OutputIntent;
    droppedIntents: Array<{ intent: OutputIntent; reason: string }>;
  } {
    const droppedIntents: Array<{ intent: OutputIntent; reason: string }> = [];
    let mergedIntent: OutputIntent | undefined;
    let status: "accepted" | "merged" | "dropped" = "accepted";
    
    if (intent.mergeKey) {
      const existingIdx = this.items.findIndex(item => item.intent.mergeKey === intent.mergeKey);
      if (existingIdx >= 0) {
        mergedIntent = this.items.splice(existingIdx, 1)[0].intent;
        status = "merged";
      }
    }

    this.items.push({ intent, enqueuedAt: this.now() });
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

  dequeueReady(): OutputIntent | undefined {
    const now = this.now();
    while (this.items.length > 0) {
      const item = this.items.shift();
      if (!item) return undefined;
      if (now - item.enqueuedAt <= item.intent.ttlMs) return item.intent;
    }
    return undefined;
  }

  cancelByCursor(cursorId: string): number {
    const before = this.items.length;
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      if (this.items[i].intent.cursorId === cursorId) this.items.splice(i, 1);
    }
    return before - this.items.length;
  }

  length(): number {
    return this.items.length;
  }
}
