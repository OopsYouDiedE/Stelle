import type { CognitiveSignal } from "./types.js";
import type { StelleEvent } from "../types.js";

export interface InnerObservation {
  id: string;
  source: "discord" | "discord_text_channel" | "live" | "live_danmaku" | "browser" | "desktop_input" | "android_device" | "stage_output" | "system";
  type: string;
  summary: string;
  timestamp: number;
  impactScore: number;
  salience: "low" | "medium" | "high";
}

export interface InnerObserver {
  recordEvent(event: StelleEvent): void;
  recordDecision(decision: InnerObservation): void;
  collectRecentSignals(limit?: number): Promise<CognitiveSignal[]>;
  recentObservations(limit: number): InnerObservation[];
  snapshot(): Record<string, unknown>;
}

export class DefaultInnerObserver implements InnerObserver {
  private readonly recentDecisions: InnerObservation[] = [];

  recordEvent(event: StelleEvent): void {
    if (event.type !== "cursor.reflection") return;
    this.recordDecision({
      id: event.id ?? `reflection-${Date.now()}`,
      source: event.source as InnerObservation["source"],
      type: event.payload.intent,
      summary: event.payload.summary,
      timestamp: event.timestamp ?? Date.now(),
      impactScore: event.payload.impactScore ?? 1,
      salience: event.payload.salience ?? "low",
    });
  }

  recordDecision(decision: InnerObservation): void {
    this.recentDecisions.push(decision);
    while (this.recentDecisions.length > 200) this.recentDecisions.shift();
  }

  async collectRecentSignals(limit = 50): Promise<CognitiveSignal[]> {
    return this.recentDecisions.slice(-limit).map(decisionToSignal);
  }

  recentObservations(limit: number): InnerObservation[] {
    return this.recentDecisions.slice(-limit);
  }

  snapshot(): Record<string, unknown> {
    return { recentDecisionCount: this.recentDecisions.length };
  }
}

function decisionToSignal(decision: InnerObservation): CognitiveSignal {
  return {
    id: decision.id,
    source: mapSourceToCognitive(decision.source),
    kind: decision.type,
    summary: decision.summary,
    timestamp: decision.timestamp,
    impactScore: decision.impactScore,
    salience: decision.salience,
  };
}

function mapSourceToCognitive(source: unknown): CognitiveSignal["source"] {
  if (typeof source !== "string") return "system";
  const s = source.toLowerCase();
  if (s === "discord" || s === "discord_text_channel") return "discord_text_channel";
  if (s === "live" || s === "live_danmaku") return "live_danmaku";
  if (s === "stage_output") return "stage_output";
  if (s === "browser") return "browser";
  if (s === "system") return "system";
  return "system";
}
