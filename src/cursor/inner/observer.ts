import type { CognitiveSignal } from "./types.js";
import type { StelleEvent } from "../types.js";

export interface InnerObserver {
  recordEvent(event: StelleEvent): void;
  collectRecentSignals(limit?: number): Promise<CognitiveSignal[]>;
  snapshot(): Record<string, unknown>;
}

export class DefaultInnerObserver implements InnerObserver {
  recordEvent(_event: StelleEvent): void {}
  async collectRecentSignals(_limit?: number): Promise<CognitiveSignal[]> { return []; }
  snapshot(): Record<string, unknown> { return {}; }
}
