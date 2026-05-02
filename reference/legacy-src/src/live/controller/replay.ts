import type { StelleEvent } from "../../utils/event_schema.js";
import type { StelleEventBus } from "../../utils/event_bus.js";
import { readLiveJournal, type LiveJournalRecord } from "./event_journal.js";

export interface LiveReplayFaults {
  rendererDisconnectAtSequence?: number;
  ttsFailureAtSequence?: number;
  platformDisconnectAtSequence?: number;
}

export interface LiveReplayScenario {
  journalPath: string;
  speed?: number;
  faults?: LiveReplayFaults;
}

export interface LiveReplayMetrics {
  eventsReplayed: number;
  received: number;
  dropped: number;
  ttsFailuresInjected: number;
  rendererDisconnectsInjected: number;
  platformDisconnectsInjected: number;
}

export async function loadLiveReplayScenario(scenario: LiveReplayScenario): Promise<LiveJournalRecord[]> {
  return readLiveJournal(scenario.journalPath);
}

export async function replayLiveJournal(
  scenario: LiveReplayScenario,
  eventBus: StelleEventBus,
  options: { now?: () => number } = {},
): Promise<LiveReplayMetrics> {
  const records = await loadLiveReplayScenario(scenario);
  const metrics: LiveReplayMetrics = {
    eventsReplayed: 0,
    received: 0,
    dropped: 0,
    ttsFailuresInjected: 0,
    rendererDisconnectsInjected: 0,
    platformDisconnectsInjected: 0,
  };
  let previousAt: number | undefined;
  const speed = Math.max(0.1, scenario.speed ?? 100);
  for (const record of records) {
    if (previousAt !== undefined) {
      const delayMs = Math.max(0, (record.recordedAt - previousAt) / speed);
      if (delayMs > 0) await sleep(Math.min(delayMs, 1000));
    }
    previousAt = record.recordedAt;
    injectFaults(record.sequence, scenario, eventBus, metrics, options.now?.() ?? Date.now());
    publishReplayEvent(record.event, eventBus);
    metrics.eventsReplayed += 1;
    if (record.event.type === "live.event.received") metrics.received += 1;
    if (record.event.type === "live.ingress.dropped") metrics.dropped += 1;
  }
  return metrics;
}

function injectFaults(
  sequence: number,
  scenario: LiveReplayScenario,
  eventBus: StelleEventBus,
  metrics: LiveReplayMetrics,
  timestamp: number,
): void {
  if (scenario.faults?.ttsFailureAtSequence === sequence) {
    metrics.ttsFailuresInjected += 1;
    eventBus.publish({
      type: "live.tts.error",
      source: "replay",
      id: `replay-tts-failure-${sequence}`,
      timestamp,
      payload: { error: "Injected replay TTS failure.", sequence },
    } as any);
  }
  if (scenario.faults?.rendererDisconnectAtSequence === sequence) {
    metrics.rendererDisconnectsInjected += 1;
    eventBus.publish({
      type: "live.platform.error",
      source: "replay",
      id: `replay-renderer-disconnect-${sequence}`,
      timestamp,
      payload: { platform: "fixture", error: "Injected renderer disconnect.", sequence },
    } as any);
  }
  if (scenario.faults?.platformDisconnectAtSequence === sequence) {
    metrics.platformDisconnectsInjected += 1;
    eventBus.publish({
      type: "live.platform.status_changed",
      source: "replay",
      id: `replay-platform-disconnect-${sequence}`,
      timestamp,
      payload: { platform: "fixture", reason: "injected_disconnect", sequence },
    } as any);
  }
}

function publishReplayEvent(event: StelleEvent, eventBus: StelleEventBus): void {
  eventBus.publish({
    ...event,
    id: `replay-${event.id}`,
    source: "replay",
    timestamp: Date.now(),
  } as any);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
