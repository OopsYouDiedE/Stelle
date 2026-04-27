/**
 * Module: Inner Cursor (Ego & Cognitive Synthesis Engine)
 */

import { asRecord } from "../utils/json.js";
import { truncateText } from "../utils/text.js";
import type { CursorContext, CursorSnapshot, StelleEvent, StelleCursor } from "./types.js";

export interface RuntimeDecision {
  id: string;
  source: "discord" | "live" | "system";
  type: string;
  summary: string;
  timestamp: number;
  impactScore: number;
  salience: "low" | "medium" | "high";
}

export interface CursorDirective {
  target: "discord" | "live" | "global";
  instruction: string;
  expiresAt: number;
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
  private readonly recentDecisions: RuntimeDecision[] = [];
  
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

  constructor(private readonly context: CursorContext) {
    this.lastReflectionAt = context.now();
    this.lastCoreReflectionAt = context.now();
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
      }
    } catch (e) {
      console.warn("[Inner] Failed to load convictions.");
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
    this.recordDecision({
      id: event.id ?? `reflection-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      source: event.source,
      type: event.payload.intent,
      summary: event.payload.summary,
      timestamp: event.timestamp ?? this.context.now(),
      impactScore: event.payload.impactScore ?? 1,
      salience: event.payload.salience ?? "low",
    });
    return { accepted: true, reason: "Reflection recorded.", eventId: event.id ?? `inner-${Date.now()}` };
  }

  recordDecision(decision: RuntimeDecision): void {
    this.recentDecisions.push(decision);
    this.unreflectedCount++;
    this.pendingImpactScore += decision.impactScore;
    while (this.recentDecisions.length > 200) this.recentDecisions.shift();
    
    const threshold = this.context.config.core.reflectionAccumulationThreshold;
    const shouldReflect = 
      decision.salience === "high" || 
      this.pendingImpactScore >= threshold || 
      this.unreflectedCount >= (threshold * 1.5);

    if (shouldReflect) {
      void this.triggerCognitiveSynthesis().catch(e => console.error("[Inner] Synthesis failed:", e));
    }
  }

  async tick(): Promise<void> {
    const now = this.context.now();
    this.activeDirectives = this.activeDirectives.filter(d => d.expiresAt > now);

    const idleTime = now - this.lastReflectionAt;
    if (this.unreflectedCount > 0 && !this.isReflecting && idleTime > 30 * 60 * 1000) {
      await this.triggerCognitiveSynthesis();
    }

    const coreInterval = Math.max(1, this.context.config.core.reflectionIntervalHours) * 60 * 60 * 1000;
    if (now - this.lastCoreReflectionAt > coreInterval && !this.isReflecting) {
      await this.triggerCoreReflection();
    }
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
        await this.context.tools.execute("memory.write_long_term", 
          { key: "current_focus", value: this.currentFocus, layer: "self_state" },
          { caller: "core", cwd: process.cwd(), allowedAuthority: ["safe_write"], allowedTools: ["memory.write_long_term"] }
        ).catch(() => {});

        await this.context.memory.appendResearchLog({
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

  async consult(source: "discord" | "live", query: string, contextPayload: string): Promise<string> {
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

  async triggerCognitiveSynthesis(): Promise<void> {
    if (this.isReflecting || !this.context.config.models.apiKey) return;
    this.isReflecting = true;
    this.status = "active";

    try {
      const decisionsToReflect = this.recentDecisions.slice(-this.unreflectedCount);
      if (decisionsToReflect.length === 0) return;

      this.unreflectedCount = 0;
      this.pendingImpactScore = 0;
      this.lastReflectionAt = this.context.now();

      const decisionLog = decisionsToReflect.map(d => `[${d.source}] ${d.type}: ${d.summary}`).join("\n");

      const prompt = [
        "You are the 'Inner Mind'. Review recent actions.",
        'Schema: {"insight":"...","globalMood":"...","newConviction":{"topic":"...","stance":"..."},"directives":[{"target":"discord|live|global","instruction":"...","lifespanMinutes":30}]}',
        `Recent Actions:\n${decisionLog}`
      ].join("\n\n");

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
              let target = String(rec.target || "global");
              if (target === "all") target = "global"; // 后向兼容处理
              return {
                target: target as "discord" | "live" | "global",
                instruction: String(rec.instruction),
                lifespanMinutes: Number(rec.lifespanMinutes || 30)
              };
            }) : []
          };
        },
        { role: "primary", temperature: 0.35, maxOutputTokens: 500 }
      );

      this.currentGlobalMood = result.globalMood;
      this.addReflection(result.insight);

      if (result.newConviction && result.newConviction.topic && result.newConviction.stance) {
        this.coreConvictions.push(result.newConviction);
        if (this.coreConvictions.length > 20) this.coreConvictions.shift(); 
        await this.context.tools.execute("memory.write_long_term", 
          { key: "core_convictions", value: JSON.stringify(this.coreConvictions), layer: "self_state" },
          { caller: "core", cwd: process.cwd(), allowedAuthority: ["safe_write"], allowedTools: ["memory.write_long_term"] }
        ).catch(() => {});
      }

      const now = this.context.now();
      for (const d of result.directives) {
        if (!d.instruction) continue;
        const expiresAt = now + (d.lifespanMinutes * 60 * 1000);
        this.activeDirectives.push({ target: d.target, instruction: d.instruction, expiresAt });
        this.context.eventBus.publish({
          type: "cursor.directive",
          source: "inner",
          payload: { target: d.target, action: "apply_policy", parameters: { instruction: d.instruction }, expiresAt, priority: 2 }
        });
      }

      await this.context.tools.execute("memory.write_long_term", 
        { key: "global_subconscious", value: this.buildContextBlock(), layer: "self_state" },
        { caller: "core", cwd: process.cwd(), allowedAuthority: ["safe_write"], allowedTools: ["memory.write_long_term"] }
      ).catch(() => {});
    } finally {
      this.isReflecting = false;
      this.status = "idle";
    }
  }

  private addReflection(text: string): void {
    this.reflections.push(`[${new Date().toLocaleTimeString()}] ${text}`);
    while (this.reflections.length > 50) this.reflections.shift();
  }

  buildContextBlock(callerSource?: "discord" | "live"): string {
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

  snapshot(): CursorSnapshot {
    return {
      id: this.id, kind: this.kind, status: this.status, summary: this.summary,
      state: {
        globalMood: this.currentGlobalMood,
        activeDirectivesCount: this.activeDirectives.length,
        convictionsCount: this.coreConvictions.length,
        unreflectedCount: this.unreflectedCount,
        lastCoreReflectionAt: this.lastCoreReflectionAt,
        currentFocusSummary: truncateText(this.currentFocus, 100),
      },
    };
  }
}
