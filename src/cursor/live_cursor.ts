/**
 * Module: Live Cursor
 *
 * Live flow:
 * 1. Danmaku/live events are normalized and hard-moderated first.
 * 2. A lightweight filter removes low-value gameplay noise before LLM routing.
 * 3. The cursor keeps two generators:
 *    - topic queue: theme-driven idle output
 *    - response queue: danmaku-triggered replies inserted ahead of idle output
 * 4. Tick drains response first, then topic, and syncs caption/stage actions.
 */
import type { ToolContext } from "../tool.js";
import { LlmJsonParseError } from "../utils/llm.js";
import { asRecord, enumValue } from "../utils/json.js";
import { formatLiveEventForPrompt, moderateLiveEvent, normalizeLiveEvent, type NormalizedLiveEvent } from "../utils/live_event.js";
import { sanitizeExternalText, splitSentences, truncateText } from "../utils/text.js";
import type { CursorContext, CursorSnapshot, RuntimeDispatchEvent, RuntimeDispatchResult, StelleCursor } from "./types.js";

export const LIVE_PERSONA = `
You are Stelle's Live Cursor.
You shape public-facing live captions, speech, stage reactions, and timing.
You keep the stream moving without sounding robotic or over-eager.
`;

interface LiveDecision {
  intent: "idle_filler" | "transition" | "status_update" | "safe_topic" | "memory_story" | "social_callout" | "factual_request" | "sensitive_request";
  broadcastRisk: "low" | "medium" | "high";
  captionMode: "replace" | "stream" | "queue";
  motion?: string;
  expression?: string;
  reason: string;
}

interface LiveRouteDecision {
  action: "drop" | "wait" | "respond";
  reason: string;
  priority: "low" | "medium" | "high";
  interest: "low" | "medium" | "high";
  needsScreen: boolean;
  risk: "low" | "medium" | "high";
}

interface LiveSpeechQueueItem {
  id: string;
  text: string;
  source: "topic" | "response";
  speaker: string;
  enqueuedAt: number;
  captionMode: "replace" | "stream" | "queue";
  motion?: string;
  expression?: string;
}

export interface LiveRequestResult {
  accepted: boolean;
  ok: boolean;
  reason: string;
  summary: string;
  stageActions: string[];
}

const LIVE_CURSOR_TOOLS = [
  "basic.datetime",
  "memory.read_long_term",
  "memory.write_recent",
  "memory.search",
  "search.web_search",
  "search.web_read",
  "live.status",
  "live.get_stage",
  "live.set_caption",
  "live.stream_caption",
  "live.show_route_decision",
  "live.push_event",
  "live.stream_tts_caption",
  "live.trigger_motion",
  "live.set_expression",
  "live.set_background",
  "obs.status",
];

export class LiveCursor implements StelleCursor {
  readonly id = "live";
  readonly kind = "live";
  readonly displayName = "Live Cursor";

  private status: CursorSnapshot["status"] = "idle";
  private summary = "Live Cursor is ready.";
  private readonly topicQueue: LiveSpeechQueueItem[] = [];
  private readonly responseQueue: LiveSpeechQueueItem[] = [];
  private lastThemeAt = 0;
  private nextThemeAt = 0;
  private tickInFlight = false;

  constructor(private readonly context: CursorContext) {}

  async receiveDispatch(event: RuntimeDispatchEvent): Promise<RuntimeDispatchResult> {
    if (event.type !== "live_request") {
      return { accepted: false, reason: `LiveCursor cannot handle ${event.type}.`, eventId: eventId() };
    }
    const result = await this.receiveRequest(event.payload);
    return { accepted: result.accepted, reason: result.summary, eventId: eventId() };
  }

  async receiveRequest(payload: Record<string, unknown>): Promise<LiveRequestResult> {
    const text = sanitizeExternalText(payload.text);
    const decision = await this.decide(text);
    const script = await this.generateScript(text, decision);
    const source = payload.source === "topic_generator" ? "topic" : "response";
    const queue = source === "topic" ? this.topicQueue : this.responseQueue;

    this.enqueueSequence(queue, splitSentences(script), {
      source,
      speaker: source === "topic" ? "topic stream" : String(payload.userName ?? "Stelle"),
      captionMode: decision.captionMode,
      motion: decision.motion,
      expression: decision.expression,
    });

    if (payload.panelText) {
      await this.useTool("live.push_event", {
        lane: source === "topic" ? "topic" : "response",
        text: String(payload.panelText),
        user_name: typeof payload.userName === "string" ? payload.userName : "Stelle",
        priority: typeof payload.priority === "string" ? payload.priority : undefined,
        note: decision.reason,
      });
    }

    await this.tick();
    this.summary = `[live:${decision.intent}] ${truncateText(script, 200)}`;
    return { accepted: true, ok: true, reason: decision.reason, summary: this.summary, stageActions: [] };
  }

  async receiveLiveEvent(payload: Record<string, unknown>): Promise<LiveRequestResult> {
    const event = normalizeLiveEvent(payload);
    const moderation = moderateLiveEvent(event);
    if (!moderation.allowed) {
      this.summary = `[live-route:drop] ${moderation.reason}`;
      await this.useTool("live.push_event", {
        event_id: event.id,
        lane: "system",
        text: event.text || moderation.reason,
        user_name: event.user?.name ?? "viewer",
        priority: event.priority,
        note: moderation.reason,
      });
      return { accepted: true, ok: true, reason: moderation.reason, summary: this.summary, stageActions: [] };
    }

    await this.useTool("live.push_event", {
      event_id: event.id,
      lane: "incoming",
      text: event.text,
      user_name: event.user?.name ?? "viewer",
      priority: event.priority,
      note: event.kind,
    });

    const interactionFilter = filterInteractiveDanmaku(event);
    if (!interactionFilter.pass) {
      this.summary = `[live-filter:drop] ${interactionFilter.reason}`;
      return { accepted: true, ok: true, reason: interactionFilter.reason, summary: this.summary, stageActions: [] };
    }

    const route = await this.routeLiveEvent(event);
    if (event.source === "fixture" || payload.debugVisible === true) {
      await this.useTool("live.show_route_decision", {
        event_id: event.id,
        action: route.action,
        reason: route.reason,
        text: event.text,
        user_name: event.user?.name ?? "viewer",
      });
    }

    this.summary = `[live-route:${route.action}] ${event.user?.name ?? "unknown"}: ${event.text}`;
    if (route.action !== "respond") {
      this.scheduleTopicSoon(route.priority === "high" ? 800 : 1800);
      return { accepted: true, ok: true, reason: route.reason, summary: this.summary, stageActions: [] };
    }

    const result = await this.receiveRequest({
      source: event.source,
      text: liveEventRequestText(event, route),
      userName: event.user?.name ?? "viewer",
      panelText: `${event.user?.name ?? "viewer"}: ${event.text}`,
      priority: event.priority,
      liveEvent: event,
      route,
    });

    if (event.priority === "high") {
      this.scheduleTopicSoon(8000);
    } else {
      this.scheduleTopicSoon(3000);
    }
    return result;
  }

  async tick(): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      const now = this.context.now();
      if (this.responseQueue.length === 0 && this.topicQueue.length === 0 && now >= this.nextThemeAt) {
        await this.generateTopicSequence();
      }

      const next = this.responseQueue.shift() ?? this.topicQueue.shift();
      if (!next) return;

      if (next.motion) {
        await this.useTool("live.trigger_motion", { group: next.motion });
      }
      if (next.expression) {
        await this.useTool("live.set_expression", { expression: next.expression });
      }

      if (this.context.config.live.ttsEnabled) {
        await this.useTool("live.stream_tts_caption", { text: next.text });
      } else if (next.captionMode === "stream") {
        await this.useTool("live.stream_caption", { text: next.text, speaker: next.speaker });
      } else {
        await this.useTool("live.set_caption", { text: next.text });
      }

      const spacingMs = estimateSpeechDurationMs(next.text) + (next.source === "topic" ? 2200 : 1400);
      if (next.source === "topic") this.lastThemeAt = now;
      this.nextThemeAt = now + spacingMs;
    } finally {
      this.tickInFlight = false;
    }
  }

  snapshot(): CursorSnapshot {
    return {
      id: this.id,
      kind: this.kind,
      status: this.status,
      summary: this.summary,
      state: {
        defaultModel: this.context.config.live.defaultModel ?? null,
        ttsEnabled: this.context.config.live.ttsEnabled,
        topicQueueLength: this.topicQueue.length,
        responseQueueLength: this.responseQueue.length,
        lastThemeAt: this.lastThemeAt,
        nextThemeAt: this.nextThemeAt,
      },
    };
  }

  private async decide(text: string): Promise<LiveDecision> {
    if (!this.context.config.models.apiKey) {
      return { intent: "safe_topic", broadcastRisk: "low", captionMode: this.context.config.live.ttsEnabled ? "stream" : "replace", reason: "fallback without LLM" };
    }

    try {
      return await this.context.llm.generateJson(
        [
          LIVE_PERSONA,
          "Return JSON only. This is the live speaking policy layer.",
          '{"intent":"idle_filler|transition|status_update|safe_topic|memory_story|social_callout|factual_request|sensitive_request","broadcastRisk":"low|medium|high","captionMode":"replace|stream|queue","motion":"optional","expression":"optional","reason":"short reason"}',
          `External live request:\n${text}`,
        ].join("\n\n"),
        "live_decision",
        normalizeLiveDecision,
        { role: "secondary", temperature: 0.2, maxOutputTokens: 220 }
      );
    } catch (error) {
      if (!(error instanceof LlmJsonParseError)) console.warn(`[Stelle] Live decision failed: ${error instanceof Error ? error.message : String(error)}`);
      return { intent: "safe_topic", broadcastRisk: "low", captionMode: this.context.config.live.ttsEnabled ? "stream" : "replace", reason: "decision fallback" };
    }
  }

  private async routeLiveEvent(event: NormalizedLiveEvent): Promise<LiveRouteDecision> {
    if (!this.context.config.models.apiKey) {
      return {
        action: event.priority === "low" ? "wait" : "respond",
        reason: "fallback without LLM",
        priority: event.priority,
        interest: event.priority === "low" ? "medium" : "high",
        needsScreen: false,
        risk: "low",
      };
    }

    try {
      return await this.context.llm.generateJson(
        [
          LIVE_PERSONA,
          "You are the first-stage live routing model.",
          "Low-value routine danmaku should often wait.",
          "Trusted payment or high-priority remarks should usually respond unless unsafe.",
          "Return JSON only.",
          '{"action":"drop|wait|respond","reason":"short reason","priority":"low|medium|high","interest":"low|medium|high","needsScreen":false,"risk":"low|medium|high"}',
          "Live event:",
          formatLiveEventForPrompt(event),
        ].join("\n\n"),
        "live_route_decision",
        normalizeLiveRouteDecision,
        { role: "secondary", temperature: 0.15, maxOutputTokens: 220 }
      );
    } catch (error) {
      if (!(error instanceof LlmJsonParseError)) console.warn(`[Stelle] Live route failed: ${error instanceof Error ? error.message : String(error)}`);
      return { action: event.priority === "low" ? "wait" : "respond", reason: "route fallback", priority: event.priority, interest: "medium", needsScreen: false, risk: "low" };
    }
  }

  private async generateScript(text: string, decision: LiveDecision): Promise<string> {
    const fallback = text || "先把直播节奏轻轻接住，顺着往下说。";
    if (!this.context.config.models.apiKey) return truncateText(fallback, 500);

    try {
      const focus = await this.context.memory?.readLongTerm("current_focus").catch(() => null);
      return truncateText(
        await this.context.llm.generateText(
          [
            LIVE_PERSONA,
            "Write short speakable live caption text. Plain text only.",
            "Avoid sounding like a chatbot. Keep it streamable and spoken.",
            `Current focus:\n${focus ?? "(none)"}`,
            `Decision: ${JSON.stringify(decision)}`,
            `Request:\n${text}`,
          ].join("\n\n"),
          { role: "primary", temperature: 0.72, maxOutputTokens: 260 }
        ),
        900
      );
    } catch {
      return truncateText(fallback, 500);
    }
  }

  private async generateTopicSequence(): Promise<void> {
    const focus = (await this.context.memory?.readLongTerm("current_focus").catch(() => null)) ?? "当前直播里的轻松话题";
    await this.receiveRequest({
      source: "topic_generator",
      text: `Generate one short live topic continuation based on this theme: ${focus}`,
      userName: "Stelle",
      panelText: `主题续说: ${focus}`,
      priority: "low",
    });
  }

  private enqueueSequence(
    queue: LiveSpeechQueueItem[],
    chunks: string[],
    options: Omit<LiveSpeechQueueItem, "id" | "text" | "enqueuedAt">
  ): void {
    const queueLimit = options.source === "topic" ? 1 : 2;
    for (const text of chunks.map(sanitizeExternalText).filter(Boolean)) {
      if (queue.length >= Math.min(this.context.config.live.speechQueueLimit, queueLimit)) break;
      queue.push({
        id: eventId(),
        text,
        enqueuedAt: this.context.now(),
        source: options.source,
        speaker: options.speaker,
        captionMode: options.captionMode,
        motion: options.motion,
        expression: options.expression,
      });
    }
  }

  private scheduleTopicSoon(ms: number): void {
    this.nextThemeAt = Math.max(this.nextThemeAt, this.context.now() + ms);
  }

  private useTool(name: string, input: Record<string, unknown>) {
    return this.context.tools.execute(name, input, this.toolContext(["readonly", "network_read", "external_write"]));
  }

  private toolContext(allowedAuthority: ToolContext["allowedAuthority"]): ToolContext {
    return { caller: "cursor", cursorId: this.id, cwd: process.cwd(), allowedAuthority, allowedTools: LIVE_CURSOR_TOOLS };
  }
}

function normalizeLiveDecision(raw: unknown): LiveDecision {
  const value = asRecord(raw);
  return {
    intent: enumValue(
      value.intent,
      ["idle_filler", "transition", "status_update", "safe_topic", "memory_story", "social_callout", "factual_request", "sensitive_request"] as const,
      "safe_topic"
    ),
    broadcastRisk: enumValue(value.broadcastRisk ?? value.broadcast_risk, ["low", "medium", "high"] as const, "low"),
    captionMode: enumValue(value.captionMode ?? value.caption_mode, ["replace", "stream", "queue"] as const, "replace"),
    motion: typeof value.motion === "string" ? value.motion : undefined,
    expression: typeof value.expression === "string" ? value.expression : undefined,
    reason: typeof value.reason === "string" ? value.reason : "live decision",
  };
}

function normalizeLiveRouteDecision(raw: unknown): LiveRouteDecision {
  const value = asRecord(raw);
  return {
    action: enumValue(value.action, ["drop", "wait", "respond"] as const, "wait"),
    reason: typeof value.reason === "string" ? value.reason : "live route decision",
    priority: enumValue(value.priority, ["low", "medium", "high"] as const, "low"),
    interest: enumValue(value.interest, ["low", "medium", "high"] as const, "medium"),
    needsScreen: value.needsScreen === true || value.needs_screen === true,
    risk: enumValue(value.risk, ["low", "medium", "high"] as const, "low"),
  };
}

function filterInteractiveDanmaku(event: NormalizedLiveEvent): { pass: boolean; reason: string } {
  if (event.priority === "high") return { pass: true, reason: "trusted high-value event" };
  const text = event.text.trim();
  if (!text) return { pass: false, reason: "empty event" };
  const gameplayPatterns = [/^1$/, /^2$/, /^扣1/u, /^签到/u, /^在/u, /^点歌/u, /^抽/u, /^投票/u, /^\+1$/];
  if (gameplayPatterns.some((pattern) => pattern.test(text))) {
    return { pass: false, reason: "interactive gameplay danmaku filtered" };
  }
  if (event.kind === "gift" || event.kind === "guard" || event.kind === "super_chat") {
    return { pass: true, reason: "trusted paid event" };
  }
  return { pass: true, reason: "normal danmaku" };
}

function liveEventRequestText(event: NormalizedLiveEvent, route: LiveRouteDecision): string {
  return [
    `Live event from ${event.user?.name ?? "viewer"}: ${event.text}`,
    `Event kind: ${event.kind}. Trusted priority: ${event.priority}.`,
    `Route: ${route.action}. Reason: ${route.reason}.`,
  ].join("\n");
}

function eventId(): string {
  return `event-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function estimateSpeechDurationMs(text: string): number {
  const cleaned = text.replace(/\s+/g, "");
  const characters = Math.max(1, cleaned.length);
  return Math.min(18000, Math.max(3200, characters * 190));
}
