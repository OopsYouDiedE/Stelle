import type { StageOutputArbiter } from "../../stage/output_arbiter.js";
import type { StelleEventBus } from "../../utils/event_bus.js";
import { TopicOrchestrator } from "./orchestrator.js";
import type { ProgramWidgetState, TopicOrchestratorOptions, TopicState } from "./types.js";

export interface LiveProgramServiceDeps {
  eventBus: StelleEventBus;
  stageOutput?: StageOutputArbiter;
  orchestrator?: TopicOrchestrator;
  options?: TopicOrchestratorOptions;
}

export interface LiveProgramSnapshot {
  topic: TopicState;
  widgets: ProgramWidgetState;
}

export class LiveProgramService {
  readonly orchestrator: TopicOrchestrator;
  private unsubscribes: Array<() => void> = [];
  private lastPublishedAt = 0;

  constructor(private readonly deps: LiveProgramServiceDeps) {
    this.orchestrator = deps.orchestrator ?? new TopicOrchestrator(deps.options);
  }

  start(): void {
    this.unsubscribes.push(this.deps.eventBus.subscribe("live.event.received", (event) => {
      const result = this.orchestrator.ingestLivePayload(event.payload);
      if (result.updated) this.publishProgramUpdate("live_event");
    }));
    this.unsubscribes.push(this.deps.eventBus.subscribe("live.batch.flushed", (event) => {
      this.orchestrator.recordBatchFlush(event.payload);
      this.publishProgramUpdate("batch_flush");
    }));
    this.unsubscribes.push(this.deps.eventBus.subscribe("live.health.updated", (event) => {
      this.orchestrator.updateStageStatus({ health: event.payload });
      this.publishProgramUpdate("health");
    }));
    this.unsubscribes.push(this.deps.eventBus.subscribe("stage.output.started", (event) => {
      this.orchestrator.updateStageStatus({ stage: { status: "speaking", lane: event.payload.intent.lane, outputId: event.payload.intent.id } });
      this.publishProgramUpdate("stage_started");
    }));
    this.unsubscribes.push(this.deps.eventBus.subscribe("stage.output.completed", (event) => {
      this.orchestrator.updateStageStatus({ stage: { status: "idle", lane: event.payload.intent.lane, outputId: event.payload.intent.id } });
      this.publishProgramUpdate("stage_completed");
    }));
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
  }

  snapshot(): LiveProgramSnapshot {
    return {
      topic: this.orchestrator.snapshot(),
      widgets: this.orchestrator.widgetState(),
    };
  }

  private publishProgramUpdate(reason: string): void {
    const now = Date.now();
    if (now - this.lastPublishedAt < 750 && reason !== "stage_started" && reason !== "stage_completed") return;
    this.lastPublishedAt = now;
    this.deps.eventBus.publish({
      type: "live.program.updated",
      source: "live_program",
      id: `live-program-${now}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: now,
      payload: { reason, ...this.snapshot() },
    } as any);
  }
}
