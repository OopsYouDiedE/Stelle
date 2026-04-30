import type { StageOutputArbiter } from "../../stage/output_arbiter.js";
import type { LiveRuntime } from "../../utils/live.js";
import type { StelleEventBus } from "../../utils/event_bus.js";
import { TopicOrchestrator } from "./orchestrator.js";
import { PublicRoomMemoryStore, type PublicRoomMemory } from "./public_memory.js";
import type { ProgramWidgetState, TopicOrchestratorOptions, TopicState } from "./types.js";

export interface LiveProgramServiceDeps {
  eventBus: StelleEventBus;
  live?: LiveRuntime;
  stageOutput?: StageOutputArbiter;
  publicMemory?: PublicRoomMemoryStore;
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
  private lastHostOutputAt = 0;
  private lastHostedPhase = "";
  private lastHostedConclusion = "";
  private publicMemories: PublicRoomMemory[] = [];

  constructor(private readonly deps: LiveProgramServiceDeps) {
    this.orchestrator = deps.orchestrator ?? new TopicOrchestrator(deps.options);
  }

  start(): void {
    void this.refreshPublicMemories();
    this.unsubscribes.push(this.deps.eventBus.subscribe("live.event.received", (event) => {
      const result = this.orchestrator.ingestLivePayload(event.payload);
      if (result.updated) {
        this.publishProgramUpdate("live_event");
        void this.maybeHost("live_event");
      }
    }));
    this.unsubscribes.push(this.deps.eventBus.subscribe("live.batch.flushed", (event) => {
      this.orchestrator.recordBatchFlush(event.payload);
      this.publishProgramUpdate("batch_flush");
      void this.maybeHost("batch_flush");
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
      widgets: this.orchestrator.widgetState(this.publicMemories),
    };
  }

  async addPublicMemory(input: Omit<PublicRoomMemory, "id" | "createdAt" | "sensitivity">): Promise<PublicRoomMemory> {
    const memory = await this.memoryStore().append(input);
    await this.refreshPublicMemories();
    this.publishProgramUpdate("public_memory");
    return memory;
  }

  private publishProgramUpdate(reason: string): void {
    const now = Date.now();
    if (now - this.lastPublishedAt < 750 && reason !== "stage_started" && reason !== "stage_completed") return;
    this.lastPublishedAt = now;
    const snapshot = this.snapshot();
    void this.publishRendererState(snapshot).catch((error) => console.warn("[LiveProgramService] renderer update failed:", error));
    this.deps.eventBus.publish({
      type: "live.program.updated",
      source: "live_program",
      id: `live-program-${now}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: now,
      payload: { reason, ...snapshot },
    } as any);
  }

  private async publishRendererState(snapshot: LiveProgramSnapshot): Promise<void> {
    await this.deps.live?.updateTopic(snapshot.topic);
    await Promise.all([
      this.deps.live?.updateWidget("topic_compass", snapshot.widgets.topic_compass),
      this.deps.live?.updateWidget("chat_cluster", snapshot.widgets.chat_cluster),
      this.deps.live?.updateWidget("conclusion_board", snapshot.widgets.conclusion_board),
      this.deps.live?.updateWidget("question_queue", snapshot.widgets.question_queue),
      this.deps.live?.updateWidget("stage_status", snapshot.widgets.stage_status),
      this.deps.live?.updateWidget("public_memory_wall", snapshot.widgets.public_memory_wall),
    ]);
    await this.deps.live?.setSceneMode(snapshot.topic.scene);
  }

  private async maybeHost(reason: string): Promise<void> {
    if (!this.deps.stageOutput) return;
    const topic = this.orchestrator.snapshot();
    const now = Date.now();
    if (now - this.lastHostOutputAt < 45_000) return;

    let text = "";
    if (topic.phase !== this.lastHostedPhase && (topic.phase === "clustering" || topic.phase === "summarizing")) {
      text = topic.phase === "clustering"
        ? `我先把弹幕分一下类：现在主要集中在${topic.clusters.slice(0, 3).map(item => item.label).join("、") || "几个方向"}。`
        : `我先收束一下：${topic.conclusions[0] ?? "目前还没有足够清晰的结论。"}`;
      this.lastHostedPhase = topic.phase;
    } else {
      const newestConclusion = topic.conclusions.at(-1) ?? "";
      if (newestConclusion && newestConclusion !== this.lastHostedConclusion && reason === "batch_flush") {
        text = newestConclusion;
        this.lastHostedConclusion = newestConclusion;
      }
    }

    if (!text) return;
    this.lastHostOutputAt = now;
    await this.deps.stageOutput.propose({
      id: `live-program-host-${now}-${Math.random().toString(36).slice(2, 7)}`,
      cursorId: "live_program",
      lane: "topic_hosting",
      priority: 38,
      salience: "low",
      text,
      summary: text,
      topic: topic.title,
      ttlMs: 20_000,
      interrupt: "none",
      output: {
        caption: true,
        tts: true,
      },
      metadata: { source: "live_program", phase: topic.phase },
    });
  }

  private memoryStore(): PublicRoomMemoryStore {
    if (!this.deps.publicMemory) this.deps.publicMemory = new PublicRoomMemoryStore();
    return this.deps.publicMemory;
  }

  private async refreshPublicMemories(): Promise<void> {
    this.publicMemories = await this.memoryStore().list(8).catch(() => []);
  }
}
