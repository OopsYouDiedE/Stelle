// === Imports ===
import type { NormalizedLiveEvent } from "../../utils/live_event.js";

// === Main Class ===
export class LiveEventDeduper {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  // --- Logic ---
  accept(event: NormalizedLiveEvent): boolean {
    const key = event.fingerprint ?? event.id;
    const t = this.now();
    this.gc(t);

    if (this.seen.has(key)) return false;

    this.seen.set(key, t + this.ttlMs);
    return true;
  }

  // --- Garbage Collection ---
  private gc(t: number): void {
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= t) this.seen.delete(key);
    }
  }
}
