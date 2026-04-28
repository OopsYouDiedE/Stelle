import type { CognitiveSignal, ReflectionDecision, ReflectionMode } from "./types.js";

export interface ReflectionPressureValve {
  record(signal: CognitiveSignal): void;
  evaluate(now: number): ReflectionDecision;
  reset(mode: ReflectionMode): void;
}

export class DefaultPressureValve implements ReflectionPressureValve {
  record(_signal: CognitiveSignal): void {}
  evaluate(_now: number): ReflectionDecision { return { mode: "none", reason: "Idle" }; }
  reset(_mode: ReflectionMode): void {}
}
