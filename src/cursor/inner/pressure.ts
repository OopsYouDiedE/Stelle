import type { CognitiveSignal, ReflectionDecision, ReflectionMode } from "./types.js";

export interface ReflectionPressureValve {
  record(signal: CognitiveSignal): void;
  evaluate(now: number): ReflectionDecision;
  reset(mode: ReflectionMode): void;
}

export class DefaultPressureValve implements ReflectionPressureValve {
  private unreflectedCount = 0;
  private pendingImpactScore = 0;
  private lastSignalAt = 0;
  private highestSalience: CognitiveSignal["salience"] = "low";

  constructor(private readonly options: {
    accumulationThreshold?: number;
    idleReflectionMs?: number;
  } = {}) {}

  record(signal: CognitiveSignal): void {
    this.unreflectedCount++;
    this.pendingImpactScore += signal.impactScore;
    this.lastSignalAt = Math.max(this.lastSignalAt, signal.timestamp);
    if (salienceRank(signal.salience) > salienceRank(this.highestSalience)) {
      this.highestSalience = signal.salience;
    }
  }

  evaluate(now: number): ReflectionDecision {
    if (this.unreflectedCount === 0) return { mode: "none", reason: "Idle" };

    const threshold = this.options.accumulationThreshold ?? 10;
    if (this.highestSalience === "high") return { mode: "research", reason: "High-salience signal." };
    if (this.pendingImpactScore >= threshold) return { mode: "quick", reason: "Accumulated impact threshold reached." };
    if (this.unreflectedCount >= Math.ceil(threshold * 1.5)) return { mode: "quick", reason: "Accumulated observation count threshold reached." };
    if (now - this.lastSignalAt > (this.options.idleReflectionMs ?? 30 * 60 * 1000)) return { mode: "quick", reason: "Idle reflection window elapsed." };
    return { mode: "none", reason: "Pressure below threshold." };
  }

  reset(_mode: ReflectionMode): void {
    this.unreflectedCount = 0;
    this.pendingImpactScore = 0;
    this.highestSalience = "low";
  }
}

function salienceRank(salience: CognitiveSignal["salience"]): number {
  if (salience === "high") return 3;
  if (salience === "medium") return 2;
  return 1;
}
