import type { StageOutputArbiter } from "../../actuator/output_arbiter.js";
import type { OutputIntent } from "../../stage/output_types.js";
import type { StelleEventBus } from "../../utils/event_bus.js";
import { normalizeLiveEvent } from "../../utils/live_event.js";
import { classifyText } from "./orchestrator.js";
import { TopicScriptRepository } from "./topic_script_repository.js";
import type { CompiledTopicScript, CompiledTopicScriptSection } from "./topic_script_schema.js";

export interface TopicScriptRuntimeDeps {
  eventBus: StelleEventBus;
  stageOutput: StageOutputArbiter;
  repository?: TopicScriptRepository;
  now?: () => number;
}

export interface TopicScriptRuntimeState {
  status: "idle" | "running" | "paused" | "completed" | "error";
  scriptId?: string;
  revision?: number;
  sectionId?: string;
  sectionIndex: number;
  interruptedCount: number;
  fallbackCount: number;
  lastError?: string;
  updatedAt: number;
}

export class TopicScriptRuntimeService {
  private readonly repository: TopicScriptRepository;
  private readonly now: () => number;
  private unsubscribes: Array<() => void> = [];
  private script?: CompiledTopicScript;
  private sectionStartedAt = 0;
  private state: TopicScriptRuntimeState;

  constructor(private readonly deps: TopicScriptRuntimeDeps) {
    this.repository = deps.repository ?? new TopicScriptRepository();
    this.now = deps.now ?? (() => Date.now());
    this.state = { status: "idle", sectionIndex: 0, interruptedCount: 0, fallbackCount: 0, updatedAt: this.now() };
  }

  async start(): Promise<void> {
    this.unsubscribes.push(this.deps.eventBus.subscribe("live.event.received", event => {
      void this.handleLivePayload(event.payload).catch(error => this.fail(error));
    }));
    this.unsubscribes.push(this.deps.eventBus.subscribe("stage.output.completed", event => {
      if (event.payload.intent.cursorId === "topic_script_runtime") void this.advance("stage_completed").catch(error => this.fail(error));
    }));
    this.unsubscribes.push(this.deps.eventBus.subscribe("core.tick", () => {
      void this.advance("tick").catch(error => this.fail(error));
    }));
    await this.loadLatestApproved();
  }

  async stop(): Promise<void> {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
  }

  snapshot(): TopicScriptRuntimeState {
    return { ...this.state };
  }

  async loadLatestApproved(): Promise<boolean> {
    const latest = await this.repository.latestApproved();
    if (!latest) return false;
    this.script = await this.repository.readCompiled(latest.scriptId, latest.revision);
    this.state = {
      status: "running",
      scriptId: this.script.scriptId,
      revision: this.script.revision,
      sectionId: this.script.sections[0]?.id,
      sectionIndex: 0,
      interruptedCount: 0,
      fallbackCount: 0,
      updatedAt: this.now(),
    };
    this.publish("topic_script.compiled", { scriptId: this.script.scriptId, revision: this.script.revision });
    await this.enterCurrentSection("load_latest");
    return true;
  }

  pause(): TopicScriptRuntimeState {
    this.state = { ...this.state, status: "paused", updatedAt: this.now() };
    return this.snapshot();
  }

  resume(): TopicScriptRuntimeState {
    if (this.script && this.state.status === "paused") {
      this.state = { ...this.state, status: "running", updatedAt: this.now() };
      void this.advance("resume");
    }
    return this.snapshot();
  }

  async skipSection(reason = "operator_skip"): Promise<TopicScriptRuntimeState> {
    if (!this.script) return this.snapshot();
    this.publish("topic_script.interrupted", { reason, sectionId: this.currentSection()?.id });
    this.state = { ...this.state, sectionIndex: this.state.sectionIndex + 1, updatedAt: this.now() };
    await this.enterCurrentSection(reason);
    return this.snapshot();
  }

  async forceFallback(reason = "operator_fallback"): Promise<TopicScriptRuntimeState> {
    const section = this.currentSection();
    if (!section) return this.snapshot();
    await this.propose(section.fallbackLines[0] ?? "这段先收束一下，我们换个安全一点的话题。", section, "topic_hosting", 42, "low", "none", { source: "fallback", reason });
    this.state = { ...this.state, fallbackCount: this.state.fallbackCount + 1, updatedAt: this.now() };
    this.publish("topic_script.fallback_used", { reason, sectionId: section.id });
    return this.snapshot();
  }

  private async handleLivePayload(payload: Record<string, unknown>): Promise<void> {
    if (this.state.status !== "running" || !this.script) return;
    const event = normalizeLiveEvent(payload);
    if (event.kind !== "danmaku" && event.kind !== "super_chat") return;
    const label = classifyText(event.text);
    if (label !== "question" && label !== "challenge") return;
    const section = this.currentSection();
    if (!section) return;
    this.publish("topic_script.interrupted", { sectionId: section.id, reason: label, text: event.text });
    this.state = { ...this.state, interruptedCount: this.state.interruptedCount + 1, updatedAt: this.now() };
    const text = label === "question"
      ? `我先接这个问题：${event.text}`
      : `这个质疑先记下来：${event.text}。我先按安全范围回应，再回到剧本。`;
    await this.propose(text, section, "direct_response", 72, "high", "soft", { sourceEventId: event.id, source: "viewer_interrupt", label });
  }

  private async advance(reason: string): Promise<void> {
    if (this.state.status !== "running" || !this.script) return;
    const section = this.currentSection();
    if (!section) return;
    if (this.sectionStartedAt && this.now() - this.sectionStartedAt < section.durationSec * 1000) return;
    this.publish("topic_script.section_completed", { sectionId: section.id, reason });
    this.state = { ...this.state, sectionIndex: this.state.sectionIndex + 1, updatedAt: this.now() };
    await this.enterCurrentSection(reason);
  }

  private async enterCurrentSection(reason: string): Promise<void> {
    const section = this.currentSection();
    if (!this.script || !section) {
      this.state = { ...this.state, status: "completed", sectionId: undefined, updatedAt: this.now() };
      return;
    }
    this.sectionStartedAt = this.now();
    this.state = { ...this.state, status: "running", sectionId: section.id, updatedAt: this.now() };
    this.publish("topic_script.section_started", { scriptId: this.script.scriptId, revision: this.script.revision, sectionId: section.id, reason });
    const firstLine = section.lockedLines[0] ?? section.softLines[0] ?? section.fallbackLines[0];
    if (!firstLine) {
      await this.forceFallback("empty_section");
      return;
    }
    await this.propose(firstLine, section, "topic_hosting", 40, "low", "none", { source: "section_start", reason });
  }

  private currentSection(): CompiledTopicScriptSection | undefined {
    return this.script?.sections[this.state.sectionIndex];
  }

  private async propose(
    text: string,
    section: CompiledTopicScriptSection,
    lane: OutputIntent["lane"],
    priority: number,
    salience: OutputIntent["salience"],
    interrupt: OutputIntent["interrupt"],
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.stageOutput.propose({
      id: `topic-script-${this.now()}-${Math.random().toString(36).slice(2, 7)}`,
      cursorId: "topic_script_runtime",
      lane,
      priority,
      salience,
      text,
      summary: text,
      topic: this.script?.title,
      ttlMs: lane === "direct_response" ? 30_000 : 20_000,
      interrupt,
      output: { caption: true, tts: true },
      metadata: {
        ...metadata,
        script_id: this.script?.scriptId,
        revision: this.script?.revision,
        section_id: section.id,
      },
    });
  }

  private publish(type: string, payload: Record<string, unknown>): void {
    this.deps.eventBus.publish({
      type: type as any,
      source: "topic_script_runtime",
      id: `${type}-${this.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: this.now(),
      payload,
    } as any);
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.state = { ...this.state, status: "error", lastError: message, updatedAt: this.now() };
  }
}
