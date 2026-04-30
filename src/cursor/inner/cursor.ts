/**
 * Module: Inner Cursor (Ego & Cognitive Synthesis Engine)
 */

import { asRecord, enumValue } from "../../utils/json.js";
import { truncateText } from "../../utils/text.js";
import type { CursorContext, CursorSnapshot, StelleEvent, StelleCursor } from "../types.js";
import { DefaultResearchAgenda } from "./research_agenda.js";
import { DefaultFieldSampler } from "./field_sampler.js";
import { DefaultSelfModel } from "./self_model.js";
import { DefaultInnerObserver } from "./observer.js";
import { DefaultPressureValve } from "./pressure.js";
import { DefaultDirectivePlanner } from "./directive_planner.js";
import { DefaultMemoryWriter, type InnerMemoryWriter } from "./memory_writer.js";
import type { CognitiveSignal, SelfModelSnapshot, FieldNote, CursorDirectiveEnvelope, ResearchAgendaUpdate } from "./types.js";

export interface RuntimeDecision {
  id: string;
  source: "discord" | "discord_text_channel" | "live" | "live_danmaku" | "browser" | "desktop_input" | "android_device" | "stage_output" | "system";
  type: string;
  summary: string;
  timestamp: number;
  impactScore: number;
  salience: "low" | "medium" | "high";
}

export interface CursorDirective {
  target: "discord" | "discord_text_channel" | "live" | "live_danmaku" | "browser" | "desktop_input" | "android_device" | "global";
  instruction: string;
  expiresAt: number;
  policy?: CursorDirectiveEnvelope["policy"];
  priority?: number;
}

export interface CoreConviction {
  topic: string;
  stance: string;
}

export class InnerCursor implements StelleCursor {
  readonly id = "inner";
  readonly kind = "inner";
  readonly displayName = "Inner Cursor";

  private status: CursorSnapshot["status"] = "idle";
  private summary = "Ego is dormant.";

  private readonly reflections: string[] = [];
  private currentGlobalMood = "calm";
  private activeDirectives: CursorDirective[] = [];
  private coreConvictions: CoreConviction[] = [];
  
  private unreflectedCount = 0;
  private pendingImpactScore = 0;
  private lastReflectionAt = 0;
  private lastCoreReflectionAt = 0;
  private isReflecting = false;
  private unsubscribes: (() => void)[] = [];
  private currentFocus = "保持轻量观察：先关注最近对话里反复出现的关系、情绪和未完成问题。";

  private readonly agenda: DefaultResearchAgenda;
  private readonly observer: DefaultInnerObserver;
  private readonly fieldSampler: DefaultFieldSampler;
  private readonly selfModel: DefaultSelfModel;
  private readonly pressure: DefaultPressureValve;
  private readonly directivePlanner: DefaultDirectivePlanner;
  private readonly memoryWriter?: InnerMemoryWriter;
  private recentFieldNotes: FieldNote[] = [];
  private recommendedLiveFocus?: string;

  constructor(private readonly context: CursorContext) {
    this.lastReflectionAt = context.now();
    this.lastCoreReflectionAt = context.now();
    this.agenda = new DefaultResearchAgenda();
    this.observer = new DefaultInnerObserver();
    this.pressure = new DefaultPressureValve({
      accumulationThreshold: context.config.core.reflectionAccumulationThreshold,
      idleReflectionMs: 30 * 60 * 1000,
    });
    this.directivePlanner = new DefaultDirectivePlanner();
    this.memoryWriter = context.memory ? new DefaultMemoryWriter(context.memory, context.tools) : undefined;
    this.fieldSampler = new DefaultFieldSampler({ maxNotes: 12, now: () => this.context.now() });
    this.selfModel = new DefaultSelfModel({
      mood: this.currentGlobalMood,
      currentFocus: this.currentFocus,
      activeConvictions: this.coreConvictions.map(c => ({ topic: c.topic, stance: c.stance, confidence: 1 })),
    });
  }

  async initialize(): Promise<void> {
    this.unsubscribes.push(
      this.context.eventBus.subscribe("inner.tick", () => {
        void this.tick().catch(e => console.error("[InnerCursor] Tick error:", e));
      })
    );
    this.unsubscribes.push(
      this.context.eventBus.subscribe("cursor.reflection", (event: Extract<StelleEvent, { type: "cursor.reflection" }>) => {
        this.receiveDispatch(event);
      })
    );
    
    if (!this.context.memory) return;
    try {
      const savedConvictions = await this.context.memory.readLongTerm("core_convictions", "self_state");
      if (savedConvictions) {
        this.coreConvictions = JSON.parse(savedConvictions) as CoreConviction[];
        this.selfModel.hydrate({
          activeConvictions: this.coreConvictions.map(c => ({ topic: c.topic, stance: c.stance, confidence: 1 })),
        });
      }
    } catch (e) {
      console.warn("[Inner] Failed to load convictions.");
    }

    try {
      const savedAgenda = await this.context.memory.readLongTerm("research_agenda", "self_state");
      if (savedAgenda) {
        const topics = JSON.parse(savedAgenda);
        this.agenda.hydrate(topics);
      }
    } catch (e) {
      console.warn("[Inner] Failed to load research agenda.");
    }

    try {
      const savedNotes = await this.context.memory.readLongTerm("field_notes", "self_state");
      if (savedNotes) {
        this.recentFieldNotes = JSON.parse(savedNotes) as FieldNote[];
      }
    } catch (e) {
      console.warn("[Inner] Failed to load field notes.");
    }

    try {
      const savedSelfModel = await this.context.memory.readLongTerm("self_model", "self_state");
      if (savedSelfModel) {
        this.selfModel.hydrate(JSON.parse(savedSelfModel));
        const snap = this.selfModel.snapshot();
        this.currentGlobalMood = snap.mood;
        this.currentFocus = snap.currentFocus;
      }
    } catch (e) {
      console.warn("[Inner] Failed to load self model. Continuing with defaults.");
    }
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
  }

  receiveDispatch(event: StelleEvent): { accepted: boolean; reason: string; eventId: string } {
    if (event.type !== "cursor.reflection") {
      return { accepted: false, reason: `InnerCursor cannot handle ${event.type}.`, eventId: event.id ?? `inner-${Date.now()}` };
    }
    this.observer.recordEvent(event);
    const normalized = {
      id: event.id ?? `reflection-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      source: event.source,
      type: event.payload.intent,
      summary: event.payload.summary,
      timestamp: event.timestamp ?? this.context.now(),
      impactScore: event.payload.impactScore ?? 1,
      salience: event.payload.salience ?? "low",
    } satisfies RuntimeDecision;
    this.bumpReflectionPressure(normalized);
    return { accepted: true, reason: "Reflection recorded.", eventId: event.id ?? `inner-${Date.now()}` };
  }

  recordDecision(decision: RuntimeDecision): void {
    this.observer.recordDecision(decision);
    this.bumpReflectionPressure(decision);
  }

  private bumpReflectionPressure(decision: RuntimeDecision): void {
    this.pressure.record(this.decisionToSignal(decision));
    this.unreflectedCount++;
    this.pendingImpactScore += decision.impactScore;

    const pressureDecision = this.pressure.evaluate(this.context.now());
    if (pressureDecision.mode !== "none") {
      void this.triggerCognitiveSynthesis().catch(e => console.error("[Inner] Synthesis failed:", e));
    }
  }

  async tick(): Promise<void> {
    const now = this.context.now();
    this.activeDirectives = this.activeDirectives.filter(d => d.expiresAt > now);

    const idleTime = now - this.lastReflectionAt;
    const pressureDecision = this.pressure.evaluate(now);
    if (this.unreflectedCount > 0 && !this.isReflecting && (idleTime > 30 * 60 * 1000 || pressureDecision.mode !== "none")) {
      await this.triggerCognitiveSynthesis();
    }

    const coreInterval = Math.max(1, this.context.config.core.reflectionIntervalHours) * 60 * 60 * 1000;
    if (now - this.lastCoreReflectionAt > coreInterval && !this.isReflecting) {
      await this.triggerCoreReflection();
    }
  }

  private mapSourceToCognitive(source: unknown): CognitiveSignal["source"] {
    if (typeof source !== "string") return "system";
    const s = source.toLowerCase();
    if (s === "discord" || s === "discord_text_channel") return "discord_text_channel";
    if (s === "live" || s === "live_danmaku") return "live_danmaku";
    if (s === "stage_output") return "stage_output";
    if (s === "browser") return "browser";
    if (s === "system") return "system";
    // Map unsupported runtime sources such as desktop_input/android_device to system
    return "system";
  }

  private decisionToSignal(decision: RuntimeDecision): CognitiveSignal {
    return {
      id: decision.id ?? `decision-${decision.timestamp}-${Math.random().toString(36).slice(2)}`,
      source: this.mapSourceToCognitive(decision.source),
      kind: decision.type,
      summary: decision.summary,
      timestamp: decision.timestamp ?? this.context.now(),
      impactScore: decision.impactScore ?? 1,
      salience: decision.salience ?? "low",
    };
  }

  async triggerCoreReflection(): Promise<void> {
    if (this.isReflecting || !this.context.config.models.apiKey || !this.context.memory) return;
    this.isReflecting = true;
    this.status = "active";

    try {
      const previousFocus = await this.context.memory.readLongTerm("current_focus", "self_state");
      const recentLogs = await this.context.memory.readResearchLogs(6);

      const prompt = [
        "You are StelleCore, the private reflective loop for Stelle.",
        "Write one concise current focus for future cursor prompts. Plain text only.",
        `Previous focus:\n${previousFocus ?? "(none)"}`,
        `Recent research logs:\n${recentLogs.join("\n\n") || "(none)"}`,
      ].join("\n\n");

      const focus = await this.context.llm.generateText(prompt, { role: "secondary", temperature: 0.5, maxOutputTokens: 240 });
      if (focus) {
        this.currentFocus = truncateText(focus, 1200);
        await this.writeSelfState("current_focus", this.currentFocus);
        await this.appendResearchLog({
          focus: this.currentFocus,
          process: [`Scheduled reflection`, `Previous focus: ${truncateText(previousFocus ?? "(none)", 240)}`],
          conclusion: this.currentFocus,
        });
        this.lastCoreReflectionAt = this.context.now();
        this.addReflection(`Core focus updated: ${truncateText(this.currentFocus, 60)}`);
      }
    } finally {
      this.isReflecting = false;
      this.status = "idle";
    }
  }

  async consult(_source: "discord" | "discord_text_channel" | "live" | "live_danmaku", query: string, _contextPayload: string): Promise<string> {
    if (!this.context.config.models.apiKey) return "跟随你的直觉。";

    const convictionBlock = this.coreConvictions.map(c => `- On ${c.topic}: ${c.stance}`).join("\n");
    const prompt = [
      "You are Stelle's 'Inner Ego'. Advice needed.",
      `Core Convictions:\n${convictionBlock || "(none)"}`,
      `Mood: ${this.currentGlobalMood}`,
      `Query: ${query}`
    ].join("\n\n");

    try {
      this.status = "active";
      const advice = await this.context.llm.generateText(prompt, { role: "primary", temperature: 0.4, maxOutputTokens: 400 });
      this.addReflection(`Consulted on [${query.substring(0, 20)}...].`);
      return advice || "保持底线，不要盲目附和。";
    } catch {
      return "遵循核心逻辑行事。";
    } finally {
      this.status = "idle";
    }
  }

  /**
   * Orchestrates the cognitive synthesis process by decomposing it into distinct phases.
   */
  async triggerCognitiveSynthesis(): Promise<void> {
    if (this.isReflecting || !this.context.config.models.apiKey) return;
    this.isReflecting = true;
    this.status = "active";

    try {
      const decisionsToReflect = this.observer.recentObservations(Math.max(20, this.unreflectedCount));
      if (decisionsToReflect.length === 0) return;

      const now = this.context.now();
      const signalCount = Math.max(20, decisionsToReflect.length);
      this.resetPressureState(now);

      const signals: CognitiveSignal[] = await this.observer.collectRecentSignals(signalCount);

      // Phase 1: Update Research Agenda
      const agendaUpdate = await this.updateResearchAgenda(signals, now);

      // Phase 2: Update Self Model
      await this.updateSelfModel(signals, agendaUpdate);

      // Phase 3: Field Sampling
      await this.performFieldSampling(signals);

      // Phase 4: Plan Directives
      this.planDirectives(now);

      // Phase 5: Global Synthesis (LLM)
      await this.generateGlobalSynthesis(decisionsToReflect, now);

    } catch (e) {
      console.error("[InnerCursor] Synthesis failed:", e);
    } finally {
      this.isReflecting = false;
      this.status = "idle";
    }
  }

  private resetPressureState(now: number): void {
    this.unreflectedCount = 0;
    this.pendingImpactScore = 0;
    this.lastReflectionAt = now;
    this.pressure.reset("quick");
  }

  private async updateResearchAgenda(signals: CognitiveSignal[], now: number): Promise<ResearchAgendaUpdate> {
    const agendaUpdate = await this.agenda.update(signals, this.getSelfSnapshot(), now);

    if (this.context.memory) {
      for (const topic of agendaUpdate.addedTopics) {
        await this.appendResearchLog({
          focus: topic.title,
          process: [
            `Topic created: ${topic.title}`,
            ...topic.evidence.map(e => `Evidence [${e.source}]: ${e.excerpt}`)
          ],
          conclusion: `New research agenda item: ${topic.id}`
        }).catch(() => {});
      }
      for (const topic of agendaUpdate.updatedTopics) {
        await this.appendResearchLog({
          focus: topic.title,
          process: [
            `Topic updated: ${topic.title}`,
            ...topic.evidence.slice(-3).map(e => `Recent Evidence [${e.source}]: ${e.excerpt}`)
          ],
          conclusion: `Updated research topic: ${topic.id} (Confidence: ${topic.confidence.toFixed(2)})`
        }).catch(() => {});
      }
      for (const topic of agendaUpdate.closedTopics) {
        await this.appendResearchLog({
          focus: topic.title,
          process: [`Topic closed: ${topic.title}`],
          conclusion: `Closed research topic: ${topic.id}`,
        }).catch(() => {});
      }

      await this.writeSelfState("research_agenda", JSON.stringify(this.agenda.activeTopics()));
    }
    return agendaUpdate;
  }

  private async updateSelfModel(signals: CognitiveSignal[], agendaUpdate: ResearchAgendaUpdate): Promise<void> {
    const selfUpdate = await this.selfModel.update({ signals, researchUpdates: agendaUpdate });
    this.applySelfModelSnapshot(selfUpdate.snapshot);

    if (this.context.memory && selfUpdate.changes.length > 0) {
      await this.writeSelfState("self_model", JSON.stringify(selfUpdate.snapshot));
      await this.writeSelfState("current_focus", this.currentFocus);
      await this.memoryWriter?.writeResearchLog(selfUpdate).catch(() => {});
    }
  }

  private async performFieldSampling(signals: CognitiveSignal[]): Promise<void> {
    const samplingResult = await this.fieldSampler.sample({
      activeTopics: this.agenda.activeTopics(),
      recentSignals: signals,
      selfModel: this.getSelfSnapshot()
    });
    this.recentFieldNotes = samplingResult.notes;
    this.recommendedLiveFocus = samplingResult.recommendedFocus;

    if (this.context.memory) {
      await this.writeSelfState("field_notes", JSON.stringify(this.recentFieldNotes));

      if (this.recentFieldNotes.length > 0) {
        await this.appendResearchLog({
          focus: "Field Sampling",
          process: [
            `Sampled ${this.recentFieldNotes.length} field notes.`,
            `Recommended focus: ${this.recommendedLiveFocus || "none"}`
          ],
          conclusion: `Field sampling complete. Recent vibes: ${this.recentFieldNotes.map(n => n.vibe).slice(0, 3).join(", ")}`
        }).catch(() => {});
      }
    }
  }

  private planDirectives(now: number): void {
    const envelopes = this.directivePlanner.plan({
      activeTopics: this.agenda.activeTopics(),
      fieldNotes: this.recentFieldNotes,
      selfModel: this.getSelfSnapshot(),
      now,
    });
    this.applyDirectiveEnvelopes(envelopes, now);
  }

  private constructCognitiveSynthesisPrompt(decisionLog: string, rawBackground: string): string {
    return [
      "You are the 'Inner Mind'. Review recent actions and synthesize a cognitive policy.",
      "Your goal is to guide the interaction cursors (Discord/Live) using structural bias and specific instructions.",
      `RECENT RAW OBSERVATIONS:\n${rawBackground || "(None)"}`,
      `RECENT STRUCTURED DECISIONS:\n${decisionLog}`,
      'Schema: {"insight":"...","globalMood":"...","newConviction":{"topic":"...","stance":"..."},"directives":[{"target":"discord_text_channel|live_danmaku|browser|desktop_input|android_device|global","policy":{"replyBias":"aggressive|normal|selective|silent","vibeIntensity":1-5,"focusTopic":"...","instruction":"..."},"lifespanMinutes":30}]}',
    ].join("\n\n");
  }

  private async generateGlobalSynthesis(decisionsToReflect: RuntimeDecision[], now: number): Promise<void> {
    const decisionLog = decisionsToReflect.map(d => `[${d.source}] ${d.type}: ${d.summary}`).join("\n");

    let rawBackground = "";
    if (this.context.memory) {
      const discordRecent = await this.context.memory.readRecent({ kind: "discord_global" }, 15).catch(() => []);
      const liveRecent = await this.context.memory.readRecent({ kind: "live" }, 10).catch(() => []);
      rawBackground = [...discordRecent, ...liveRecent]
        .sort((a, b) => a.timestamp - b.timestamp)
        .map(e => `[Raw:${e.source}] ${e.text}`).join("\n");
    }

    const prompt = this.constructCognitiveSynthesisPrompt(decisionLog, rawBackground);

    const result = await this.context.llm.generateJson(
      prompt,
      "cognitive_synthesis",
      (raw: any) => {
        const v = asRecord(raw);
        return {
          insight: String(v.insight || "Processing."),
          globalMood: String(v.globalMood || this.currentGlobalMood),
          newConviction: v.newConviction ? { topic: String(asRecord(v.newConviction).topic), stance: String(asRecord(v.newConviction).stance) } : undefined,
          directives: Array.isArray(v.directives) ? v.directives.map((d: any) => {
            const rec = asRecord(d);
            const pol = asRecord(rec.policy);
            let target = String(rec.target || "global");
            if (target === "all") target = "global";
            if (target === "discord") target = "discord_text_channel";
            if (target === "live") target = "live_danmaku";
            return {
              target: target as CursorDirective["target"],
              policy: {
                replyBias: pol.replyBias ? enumValue(pol.replyBias, ["aggressive", "normal", "selective", "silent"] as const, "normal") : undefined,
                vibeIntensity: typeof pol.vibeIntensity === "number" ? pol.vibeIntensity : undefined,
                focusTopic: pol.focusTopic ? String(pol.focusTopic) : undefined,
                instruction: pol.instruction ? String(pol.instruction) : undefined,
              },
              lifespanMinutes: Number(rec.lifespanMinutes || 30)
            };
          }) : []
        };
      },
      {
        role: "primary",
        temperature: 0.35,
        maxOutputTokens: 600,
        safeDefault: {
          insight: "Processing.",
          globalMood: this.currentGlobalMood,
          directives: [],
        },
      }
    );

    this.currentGlobalMood = result.globalMood;
    this.addReflection(result.insight);

    if (result.newConviction && result.newConviction.topic && result.newConviction.stance) {
      this.coreConvictions.push(result.newConviction);
      if (this.coreConvictions.length > 20) this.coreConvictions.shift(); 
      this.selfModel.hydrate({
        activeConvictions: this.coreConvictions.map(c => ({ topic: c.topic, stance: c.stance, confidence: 1 })),
      });
      if (this.context.memory) {
        await this.writeSelfState("core_convictions", JSON.stringify(this.coreConvictions));
      }
    }

    for (const d of result.directives) {
      const instruction = d.policy.instruction || "";
      if (!instruction && !d.policy.replyBias && !d.policy.vibeIntensity) continue; 
      
      this.applyDirectiveEnvelopes([{
        target: d.target,
        action: "apply_policy",
        policy: d.policy,
        expiresAt: now + (d.lifespanMinutes * 60 * 1000),
        priority: 2,
      }], now);
    }

    if (this.context.memory) {
      await this.writeSelfState("global_subconscious", this.buildContextBlock());
    }
  }

  private addReflection(text: string): void {
    this.reflections.push(`[${new Date().toLocaleTimeString()}] ${text}`);
    while (this.reflections.length > 50) this.reflections.shift();
  }

  private async writeSelfState(key: string, value: string): Promise<void> {
    if (!this.context.memory) return;
    await this.memoryWriter?.writeSelfState(key, value).catch(() => {});
  }

  private async appendResearchLog(input: { focus: string; process: string[]; conclusion: string }): Promise<void> {
    if (!this.context.memory) return;
    await this.memoryWriter?.appendResearchLog(input).catch(() => {});
  }

  buildContextBlock(callerSource?: "discord" | "discord_text_channel" | "live" | "live_danmaku"): string {
    const relevantDirectives = this.activeDirectives
      .filter(d => d.target === "global" || (callerSource && d.target === callerSource))
      .map(d => `[URGENT DIRECTIVE]: ${d.instruction}`);
    const allDirectivesForStorage = this.activeDirectives
      .map(d => `[DIRECTIVE TO ${d.target.toUpperCase()}]: ${d.instruction}`);
    const displayDirectives = callerSource ? relevantDirectives : allDirectivesForStorage;

    return [
      "--- CORE EGO ---",
      `Mood: ${this.currentGlobalMood}`,
      ...displayDirectives,
      "Convictions:",
      ...this.coreConvictions.slice(-5).map(c => `- ${c.stance}`),
    ].join("\n");
  }

  private getSelfSnapshot(): SelfModelSnapshot {
    return this.selfModel.snapshot();
  }

  private applyDirectiveEnvelopes(envelopes: CursorDirectiveEnvelope[], now: number): void {
    for (const envelope of envelopes) {
      const instruction = envelope.policy?.instruction || envelope.policy?.focusTopic || envelope.action;
      if (!instruction && !envelope.policy?.replyBias && !envelope.policy?.vibeIntensity) continue;
      const expiresAt = envelope.expiresAt ?? now + 30 * 60 * 1000;
      this.activeDirectives.push({
        target: envelope.target,
        instruction: instruction || "Policy update",
        expiresAt,
        policy: envelope.policy,
        priority: envelope.priority,
      });
      this.context.eventBus.publish({
        type: "cursor.directive",
        source: "inner",
        id: `dir-${now}-${Math.random().toString(36).slice(2, 5)}`,
        timestamp: now,
        payload: {
          target: envelope.target,
          action: envelope.action,
          policy: envelope.policy,
          expiresAt,
          priority: envelope.priority,
        },
      });
    }
  }

  private applySelfModelSnapshot(snapshot: SelfModelSnapshot): void {
    this.currentGlobalMood = snapshot.mood;
    this.currentFocus = snapshot.currentFocus || this.currentFocus;
    this.coreConvictions = snapshot.activeConvictions
      .slice(0, 20)
      .map(c => ({ topic: c.topic, stance: c.stance }));
  }

  snapshot(): CursorSnapshot {
    const selfSnap = this.selfModel.snapshot();
    return {
      id: this.id, kind: this.kind, status: this.status, summary: this.summary,
      state: {
        globalMood: this.currentGlobalMood,
        activeDirectivesCount: this.activeDirectives.length,
        convictionsCount: this.coreConvictions.length,
        unreflectedCount: this.unreflectedCount,
        lastCoreReflectionAt: this.lastCoreReflectionAt,
        currentFocusSummary: truncateText(this.currentFocus, 100),
        fieldNotesCount: this.recentFieldNotes.length,
        recommendedLiveFocus: this.recommendedLiveFocus,
        selfModelMood: selfSnap.mood,
        selfModelWarningsCount: selfSnap.behavioralWarnings.length,
        selfModelConvictionsCount: selfSnap.activeConvictions.length,
        ...this.observer.snapshot(),
        ...this.agenda.snapshot(),
      },
    };
  }
}
