import type { CognitiveSignal, ReflectionDecision, ReflectionMode } from "./types.js";

// === Region: Interfaces ===

export interface ReflectionPressureValve {
  record(signal: CognitiveSignal): void;
  evaluate(now: number): ReflectionDecision;
  reset(mode: ReflectionMode): void;
}

// === Region: Default Implementation ===

export class DefaultPressureValve implements ReflectionPressureValve {
  private unreflectedCount = 0;
  private pendingImpactScore = 0;
  private lastSignalAt = 0;
  private highestSalience: CognitiveSignal["salience"] = "low";

  constructor(
    private readonly options: {
      accumulationThreshold?: number;
      idleReflectionMs?: number;
    } = {},
  ) {}

  record(signal: CognitiveSignal): void {
    this.unreflectedCount++;
    this.pendingImpactScore += signal.impactScore;
    this.lastSignalAt = Math.max(this.lastSignalAt, signal.timestamp);
    if (SALIENCE_RANKS[signal.salience] > SALIENCE_RANKS[this.highestSalience]) {
      this.highestSalience = signal.salience;
    }
  }

  evaluate(now: number): ReflectionDecision {
    if (this.unreflectedCount === 0) return { mode: "none", reason: "Idle" };

    const threshold = this.options.accumulationThreshold ?? 10;

    // 1. High Salience check
    if (this.highestSalience === "high") return { mode: "research", reason: "High-salience signal." };

    // 2. Impact check
    if (this.pendingImpactScore >= threshold) return { mode: "quick", reason: "Accumulated impact threshold reached." };

    // 3. Count check
    if (this.unreflectedCount >= Math.ceil(threshold * 1.5))
      return { mode: "quick", reason: "Accumulated observation count threshold reached." };

    // 4. Idle time check
    const idleMs = this.options.idleReflectionMs ?? 30 * 60 * 1000;
    if (now - this.lastSignalAt > idleMs) return { mode: "quick", reason: "Idle reflection window elapsed." };

    return { mode: "none", reason: "Pressure below threshold." };
  }

  reset(_mode: ReflectionMode): void {
    this.unreflectedCount = 0;
    this.pendingImpactScore = 0;
    this.highestSalience = "low";
  }
}

// === Region: Helpers ===

const SALIENCE_RANKS: Record<CognitiveSignal["salience"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};
