// === Imports ===
import type { RuntimeConfig } from "../../../config/index.js";
import type { StelleEventBus } from "../../../core/event/event_bus.js";
import { TopicOrchestrator } from "./orchestrator.js";
import { PublicRoomMemoryStore, type PublicRoomMemory } from "./public_memory.js";
import { WorldCanonStore, type WorldCanonEntry } from "./world_canon.js";
import { PromptLabService, type PromptLabExperiment } from "./prompt_lab.js";
import type { ProgramWidgetState, TopicOrchestratorOptions, TopicPhase, TopicState } from "./types.js";
import { sanitizeExternalText, truncateText } from "../../../shared/text.js";
import type { OutputIntent } from "../../expression/stage_output/types.js";

// === Interfaces ===

export interface StageDirectorDeps {
  config: RuntimeConfig;
  eventBus: StelleEventBus;
  stageView?: {
    updateTopic(state: unknown): Promise<unknown>;
    setSceneMode(scene: string): Promise<unknown>;
    updateWidget(widget: string, state: unknown): Promise<unknown>;
  };
  publicMemory?: PublicRoomMemoryStore;
  worldCanon?: WorldCanonStore;
  promptLab?: PromptLabService;
  orchestrator?: TopicOrchestrator;
  options?: TopicOrchestratorOptions;
  now: () => number;
}

export interface StageDirectorSnapshot {
  topic: TopicState;
  widgets: ProgramWidgetState;
}

// === Main Class ===

/**
 * StageDirector
 *
 * Unified controller that manages both rule-based engagement (thanks, idle, schedule)
 * and program orchestration (topic management, widgets).
 *
 * Instead of writing directly to OutputArbiter, it primarily emits ProposalEvents
 * to allow coordination by the RuntimeKernel and output capabilities.
 */
export class StageDirector {
  readonly orchestrator: TopicOrchestrator;
  private unsubscribes: Array<() => void> = [];

  // Engagement state
  private lastActivityAt: number;
  private lastIdleOutputAt = 0;
  private readonly lastThanksAt = new Map<string, number>();
  private readonly scheduleLastRunAt = new Map<string, number>();

  // Program state
  private lastPublishedAt = 0;
  private lastHostOutputAt = 0;
  private lastHostedPhase = "";
  private lastHostedConclusion = "";
  private publicMemories: PublicRoomMemory[] = [];
  private worldCanonEntries: WorldCanonEntry[] = [];
  private promptLabExperiments: PromptLabExperiment[] = [];

  constructor(private readonly deps: StageDirectorDeps) {
    this.orchestrator = deps.orchestrator ?? new TopicOrchestrator(deps.options);
    this.lastActivityAt = deps.now();
  }

  // === Lifecycle ===

  start(): void {
    void this.refreshPublicMemories();
    void this.refreshWorldCanon();

    // 1. Listen to platform-neutral interactions for engagement and program tracking
    this.unsubscribes.push(
      this.deps.eventBus.subscribe("program.interaction.received", (event) => {
        this.lastActivityAt = this.deps.now();
        this.ingestInteractionPayload(asRecord(event.payload));
      }),
    );

    // 2. Scheduled/Idle ticks
    this.unsubscribes.push(
      this.deps.eventBus.subscribe("program.tick", () => {
        void this.handleTick().catch((err) => console.error("[StageDirector] Tick error:", err));
      }),
    );

    // 3. Program orchestration events
    this.unsubscribes.push(
      this.deps.eventBus.subscribe("program.batch.flushed", (event) => {
        this.orchestrator.recordBatchFlush(asRecord(event.payload));
        this.publishProgramUpdate("batch_flush");
        void this.maybeHost("batch_flush");
      }),
    );

    this.unsubscribes.push(
      this.deps.eventBus.subscribe("program.stage_status_changed", (event) => {
        this.orchestrator.updateStageStatus({ health: asRecord(event.payload) });
        this.publishProgramUpdate("health");
      }),
    );

    this.unsubscribes.push(
      this.deps.eventBus.subscribe("stage.output.started", (event) => {
        const payload = asRecord(event.payload);
        const intent = asRecord(payload.intent);
        this.orchestrator.updateStageStatus({
          stage: { status: "speaking", lane: String(intent.lane ?? ""), outputId: String(intent.id ?? "") },
        });
        this.publishProgramUpdate("stage_started");
      }),
    );

    this.unsubscribes.push(
      this.deps.eventBus.subscribe("stage.output.completed", (event) => {
        const payload = asRecord(event.payload);
        const intent = asRecord(payload.intent);
        this.orchestrator.updateStageStatus({
          stage: { status: "idle", lane: String(intent.lane ?? ""), outputId: String(intent.id ?? "") },
        });
        this.publishProgramUpdate("stage_completed");
      }),
    );

    this.unsubscribes.push(
      this.deps.eventBus.subscribe("program.control.command", (event) => {
        const payload = asRecord(event.payload);
        const action = payload.action;
        const parameters = asRecord(payload.parameters);
        if (action === "topic_orchestrator.update") {
          const { title, currentQuestion } = parameters;
          this.orchestrator.updateTopic(String(title ?? ""), String(currentQuestion ?? ""));
          this.publishProgramUpdate("tool_update");
        }
      }),
    );
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
  }

  snapshot(): StageDirectorSnapshot {
    return {
      topic: this.orchestrator.snapshot(),
      widgets: this.orchestrator.widgetState(this.publicMemories, this.worldCanonEntries, this.promptLabExperiments),
    };
  }

  // === Engagement Logic ===

  public ingestInteractionPayload(payload: Record<string, unknown>): void {
    const res = this.orchestrator.ingestInteractionPayload(payload);
    if (res.updated) {
      this.publishProgramUpdate("program_interaction");
      void this.maybeHost("program_interaction");
    }
    if (res.transition) {
      this.publishTransition(res.transition.from!, res.transition.to!);
    }

    // Handle engagement (thanks)
    void this.handleEngagementEvent(payload).catch((err) => console.error("[StageDirector] Engagement error:", err));
  }

  public setPhase(phase: TopicPhase): void {
    const res = this.orchestrator.setPhase(phase);
    if (res.updated) {
      this.publishProgramUpdate("manual_phase");
      this.publishTransition(res.from!, res.to!);
    }
  }

  private publishTransition(from: string, to: string): void {
    const topic = this.orchestrator.snapshot();
    // Transition events are the handoff layer between the program orchestrator and the
    // RuntimeKernel and output capabilities, which turn phase changes into spoken or visual hosting updates.
    this.deps.eventBus.publish({
      type: "program.topic.transition",
      source: "stage_director",
      id: `trans-${this.deps.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: this.deps.now(),
      payload: {
        topicId: topic.topicId,
        title: topic.title,
        fromPhase: from,
        toPhase: to,
      },
    } as any);
  }

  private async handleEngagementEvent(payload: Record<string, unknown>): Promise<void> {
    const event = normalizeProgramEvent(payload);
    const thanks = this.stageDirectorConfig().thanks;
    if (!thanks.enabled) return;

    const text = this.thanksText(event);
    if (!text) return;

    const key = `${event.kind}:${event.user?.id ?? event.user?.name ?? "unknown"}:${event.trustedPayment?.giftName ?? ""}`;
    const cooldownMs = thanks.cooldownSeconds * 1000;
    const lastAt = this.lastThanksAt.get(key) ?? 0;
    if (this.deps.now() - lastAt < cooldownMs) return;
    this.lastThanksAt.set(key, this.deps.now());

    await this.proposeProposal({
      sourceEventId: event.id,
      lane: "direct_response",
      priority: event.kind === "super_chat" || event.kind === "guard" ? 75 : event.kind === "gift" ? 65 : 50,
      salience: event.kind === "super_chat" || event.kind === "guard" ? "high" : "medium",
      text,
      ttlMs: 15_000,
      interrupt: event.kind === "super_chat" || event.kind === "guard" ? "soft" : "none",
      metadata: { source: "engagement_thanks", eventKind: event.kind, platform: event.source },
    });
  }

  private async handleTick(): Promise<void> {
    const now = this.deps.now();

    // Idle logic
    const idle = this.stageDirectorConfig().idle;
    if (idle.enabled && idle.templates.length > 0) {
      if (
        now - this.lastActivityAt >= idle.minQuietSeconds * 1000 &&
        now - this.lastIdleOutputAt >= idle.cooldownSeconds * 1000
      ) {
        this.lastIdleOutputAt = now;
        this.lastActivityAt = now;
        await this.proposeProposal({
          lane: "topic_hosting",
          priority: 42,
          salience: "low",
          text: renderTemplate(pick(idle.templates), this.variables()),
          ttlMs: 30_000,
          interrupt: "none",
          metadata: { source: "idle_task" },
        });
      }
    }

    // Schedule logic
    // These scheduled proposals intentionally stay advisory; the cursor decides whether
    // to surface them, rewrite them, or drop them against the current chat flow.
    const schedule = this.stageDirectorConfig().schedule;
    if (schedule.enabled) {
      for (const item of schedule.items) {
        if (!item.enabled || item.templates.length === 0) continue;
        const lastAt = this.scheduleLastRunAt.get(item.id) ?? 0;
        if (lastAt && now - lastAt < item.intervalSeconds * 1000) continue;
        if (!lastAt) {
          this.scheduleLastRunAt.set(item.id, now);
          continue;
        }
        this.scheduleLastRunAt.set(item.id, now);
        await this.proposeProposal({
          lane: "topic_hosting",
          priority: 48,
          salience: "low",
          text: renderTemplate(pick(item.templates), this.variables()),
          ttlMs: 30_000,
          interrupt: "none",
          metadata: { source: "schedule_task", scheduleId: item.id },
        });
      }
    }
  }

  private thanksText(event: ProgramInteractionEvent): string | undefined {
    const thanks = this.stageDirectorConfig().thanks;
    const amount = event.trustedPayment?.amount ?? 0;
    if ((event.kind === "gift" || event.kind === "super_chat") && amount < thanks.giftLowestAmount) return undefined;

    const templates =
      event.kind === "entrance"
        ? thanks.entranceTemplates
        : event.kind === "follow"
          ? thanks.followTemplates
          : event.kind === "gift"
            ? thanks.giftTemplates
            : event.kind === "guard"
              ? thanks.guardTemplates
              : event.kind === "super_chat"
                ? thanks.superChatTemplates
                : [];
    if (!templates.length) return undefined;

    const username = truncateText(sanitizeExternalText(event.user?.name ?? "观众"), thanks.usernameMaxLen);
    return renderTemplate(pick(templates), {
      ...this.variables(),
      username,
      platform: event.source,
      comment: event.text,
      gift_name: event.trustedPayment?.giftName ?? (event.text || "礼物"),
      amount: event.trustedPayment?.amount ?? "",
      currency: event.trustedPayment?.currency ?? "",
    });
  }

  private variables(): Record<string, string | number> {
    const now = new Date();
    return {
      time: now.toLocaleTimeString("zh-CN", { hour12: false }),
    };
  }

  // === Program Coordination ===

  private async maybeHost(reason: string): Promise<void> {
    const topic = this.orchestrator.snapshot();
    const now = this.deps.now();
    if (now - this.lastHostOutputAt < 45_000) return;

    let text = "";
    if (topic.phase !== this.lastHostedPhase && (topic.phase === "clustering" || topic.phase === "summarizing")) {
      text =
        topic.phase === "clustering"
          ? `我先把当前输入分一下类：现在主要集中在${
              topic.clusters
                .slice(0, 3)
                .map((item) => clusterTitle(item.label))
                .join("、") || "几个方向"
            }。`
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
    await this.proposeProposal({
      lane: "topic_hosting",
      priority: 38,
      salience: "low",
      text,
      summary: text,
      topic: topic.title,
      ttlMs: 20_000,
      interrupt: "none",
      metadata: { source: "stage_director", phase: topic.phase },
    });
  }

  private async proposeProposal(input: Omit<OutputIntent, "id" | "cursorId" | "output">): Promise<void> {
    const text = sanitizeExternalText(input.text).trim();
    if (!text) return;

    // Output a proposal event instead of direct arbiter call
    this.deps.eventBus.publish({
      type: "program.output.proposal",
      source: "stage_director",
      id: `prop-${this.deps.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: this.deps.now(),
      payload: {
        intent: {
          ...input,
          text,
          summary: text,
        },
        cursorId: "program.stage_director",
      },
    } as any);
  }

  // === Public APIs ===

  async addPublicMemory(input: Omit<PublicRoomMemory, "id" | "createdAt" | "sensitivity">): Promise<PublicRoomMemory> {
    const memory = await this.memoryStore().append(input);
    await this.refreshPublicMemories();
    this.publishProgramUpdate("public_memory");
    return memory;
  }

  async proposeWorldCanon(input: { title: string; summary: string; conflictNote?: string }): Promise<WorldCanonEntry> {
    const entry = await this.canonStore().propose({ ...input, source: "audience_proposal" });
    await this.refreshWorldCanon();
    this.publishProgramUpdate("world_canon");
    return entry;
  }

  async runPromptLab(question: string): Promise<PromptLabExperiment> {
    const experiment = await this.promptLabService().run(question);
    this.promptLabExperiments = this.promptLabService().list();
    this.publishProgramUpdate("prompt_lab");
    return experiment;
  }

  // === Internal State Management ===

  private publishProgramUpdate(reason: string): void {
    const now = this.deps.now();
    if (now - this.lastPublishedAt < 750 && reason !== "stage_started" && reason !== "stage_completed") return;
    this.lastPublishedAt = now;
    const snapshot = this.snapshot();
    void this.publishRendererState(snapshot).catch((error) =>
      console.warn("[StageDirector] renderer update failed:", error),
    );
    this.deps.eventBus.publish({
      type: "program.updated",
      source: "program.stage_director",
      id: `program-${now}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: now,
      payload: { reason, ...snapshot },
    } as any);
  }

  private async publishRendererState(snapshot: StageDirectorSnapshot): Promise<void> {
    if (!this.deps.stageView) return;
    const { topic, widgets } = snapshot;

    const tasks = [this.deps.stageView.updateTopic(topic), this.deps.stageView.setSceneMode(topic.scene)];

    for (const [key, state] of Object.entries(widgets)) {
      tasks.push(this.deps.stageView.updateWidget(key, state));
    }

    await Promise.all(tasks);
  }

  private memoryStore(): PublicRoomMemoryStore {
    if (!this.deps.publicMemory) this.deps.publicMemory = new PublicRoomMemoryStore();
    return this.deps.publicMemory;
  }

  private async refreshPublicMemories(): Promise<void> {
    this.publicMemories = await this.memoryStore()
      .list(8)
      .catch(() => []);
  }

  private canonStore(): WorldCanonStore {
    if (!this.deps.worldCanon) this.deps.worldCanon = new WorldCanonStore();
    return this.deps.worldCanon;
  }

  private async refreshWorldCanon(): Promise<void> {
    this.worldCanonEntries = await this.canonStore()
      .list(8)
      .catch(() => []);
  }

  private promptLabService(): PromptLabService {
    if (!this.deps.promptLab) this.deps.promptLab = new PromptLabService();
    return this.deps.promptLab;
  }

  private stageDirectorConfig() {
    return this.deps.config.program?.stageDirector ?? this.deps.config.live;
  }
}

interface ProgramInteractionEvent {
  id: string;
  source: string;
  kind: "text" | "super_chat" | "gift" | "guard" | "entrance" | "follow" | "like" | "system" | "unknown";
  receivedAt: number;
  user?: { id?: string; name?: string };
  text: string;
  trustedPayment?: {
    amount?: number;
    currency?: string;
    giftName?: string;
    rawType: "super_chat" | "gift" | "guard";
  };
}

function normalizeProgramEvent(payload: Record<string, unknown>): ProgramInteractionEvent {
  const inner = (payload.payload && typeof payload.payload === "object" ? payload.payload : payload) as Record<
    string,
    unknown
  >;
  const actor = (inner.actor && typeof inner.actor === "object" ? inner.actor : inner.user) as
    | Record<string, unknown>
    | undefined;
  const kind = String(inner.kind ?? "text");
  const paymentKind = kind === "super_chat" || kind === "gift" || kind === "guard" ? kind : undefined;
  return {
    id: String(payload.id ?? `program-interaction-${Date.now()}`),
    source: String(payload.sourceWindow ?? payload.source ?? "runtime"),
    kind:
      kind === "super_chat" ||
      kind === "gift" ||
      kind === "guard" ||
      kind === "entrance" ||
      kind === "follow" ||
      kind === "like" ||
      kind === "system"
        ? kind
        : "text",
    receivedAt: Number(payload.timestamp ?? Date.now()),
    user: actor
      ? {
          id: typeof actor.id === "string" ? actor.id : undefined,
          name: typeof actor.name === "string" ? actor.name : String(actor.displayName ?? ""),
        }
      : undefined,
    text: String(inner.text ?? ""),
    trustedPayment:
      paymentKind && (inner.trust as { paid?: boolean } | undefined)?.paid === true
        ? { rawType: paymentKind }
        : undefined,
  };
}

// === Helper Functions ===

function pick(values: string[]): string {
  return values[Math.floor(Math.random() * values.length)] ?? "";
}

function renderTemplate(template: string, variables: Record<string, string | number>): string {
  const randomized = template.replace(/\[([^\[\]]+)\]/g, (_match, content: string) => {
    const options = content
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);
    return options.length ? pick(options) : content;
  });
  return randomized.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    const value = variables[key];
    return value === undefined ? match : String(value);
  });
}

function clusterTitle(label: string): string {
  const titles: Record<string, string> = {
    question: "问题",
    opinion: "观点",
    joke: "吐槽/玩笑",
    setting_suggestion: "设定建议",
    challenge: "挑战/质疑",
    other: "其他",
  };
  return titles[label] ?? label;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
