import type { MemoryStore } from "../../memory/store/memory_store.js";

export interface ReflectionSnapshot {
  id: "cognition.reflection";
  status: "idle" | "reflecting";
  summary: string;
  lastReflectionAt?: number;
  pendingSignals: number;
}

export class ReflectionEngine {
  private status: ReflectionSnapshot["status"] = "idle";
  private summary = "Reflection capability is observing runtime signals.";
  private lastReflectionAt?: number;
  private pendingSignals = 0;

  constructor(private readonly memory?: MemoryStore) {}

  observeSignal(): void {
    this.pendingSignals += 1;
  }

  async reflect(reason = "manual"): Promise<ReflectionSnapshot> {
    this.status = "reflecting";
    try {
      const recent = await this.memory?.readRecent({ kind: "discord_global" }, 5).catch(() => []);
      this.summary = `Reflection completed (${reason}); recent context items=${recent?.length ?? 0}.`;
      this.lastReflectionAt = Date.now();
      this.pendingSignals = 0;
      return this.snapshot();
    } finally {
      this.status = "idle";
    }
  }

  snapshot(): ReflectionSnapshot {
    return {
      id: "cognition.reflection",
      status: this.status,
      summary: this.summary,
      lastReflectionAt: this.lastReflectionAt,
      pendingSignals: this.pendingSignals,
    };
  }
}
