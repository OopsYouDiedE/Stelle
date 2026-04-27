/**
 * Module: Live Cursor (V2 - Modular Refactored Architecture)
 */

import { truncateText } from "../utils/text.js";
import type { CursorContext, CursorSnapshot, StelleEvent, StelleCursor } from "./types.js";
import { LiveGateway } from "./live/gateway.js";
import { LiveRouter } from "./live/router.js";
import { LiveExecutor } from "./live/executor.js";
import { LiveResponder } from "./live/responder.js";
import { CURSOR_CAPABILITIES } from "./capabilities.js";
import { PolicyOverlayStore } from "./policy_overlay_store.js";
import type { LiveAction, LiveEmotion } from "./live/types.js";

export const LIVE_PERSONA = `
You are Stelle's Live Cursor (VTuber/Streamer AI).
You manage the vibe of the stream. You speak naturally, briefly, and with emotional intelligence.
Do not act like a robotic assistant. Acknowledge the crowd, play along with jokes, and keep the stream moving.
`;

export class LiveCursor implements StelleCursor {
  readonly id = "live";
  readonly kind = "live";
  readonly displayName = "Live Cursor";

  private status: CursorSnapshot["status"] = "idle";
  private summary = "Live stream engine refactored.";

  private readonly gateway: LiveGateway;
  private readonly router: LiveRouter;
  private readonly executor: LiveExecutor;
  private readonly responder: LiveResponder;

  private nextThemeAt = 0;
  private isGenerating = false;
  private tickInFlight = false;
  private currentEmotion: LiveEmotion = "neutral";
  
  private readonly policyStore: PolicyOverlayStore;
  private unsubscribes: (() => void)[] = [];

  constructor(private readonly context: CursorContext) {
    this.gateway = new LiveGateway(context);
    this.router = new LiveRouter(context, LIVE_PERSONA);
    this.executor = new LiveExecutor(context, this.id);
    this.responder = new LiveResponder(context, [...CURSOR_CAPABILITIES.live.stageTools]);
    this.policyStore = new PolicyOverlayStore(context);
  }

  async initialize(): Promise<void> {
    this.unsubscribes.push(this.context.eventBus.subscribe("live.tick", () => {
      void this.tick().catch(e => console.error("[LiveCursor] Tick error:", e));
    }));

    this.unsubscribes.push(this.context.eventBus.subscribe("live.topic_request", (event: Extract<StelleEvent, { type: "live.topic_request" }>) => {
      void this.receiveTopicRequest(event).catch(e => console.error("[LiveCursor] Topic request error:", e));
    }));

    this.unsubscribes.push(this.context.eventBus.subscribe("live.direct_say", (event: Extract<StelleEvent, { type: "live.direct_say" }>) => {
      void this.receiveDirectSay(event).catch(e => console.error("[LiveCursor] Direct say error:", e));
    }));

    this.unsubscribes.push(this.context.eventBus.subscribe("live.request", (event: Extract<StelleEvent, { type: "live.request" }>) => {
      void this.receiveTopicRequest(event).catch(e => console.error("[LiveCursor] Legacy live request error:", e));
    }));

    this.unsubscribes.push(this.context.eventBus.subscribe("live.event.received", (event: any) => {
      void this.receiveLiveEvent(event.payload).catch(e => console.error("[LiveCursor] Live event error:", e));
    }));

    this.unsubscribes.push(this.policyStore.subscribe((summary) => { this.summary = summary; }));
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
    this.gateway.clear();
  }

  /**
   * 路由：接收外部强推指令 (通常来自系统或调试)
   */
  async receiveDirectSay(event: StelleEvent): Promise<{ accepted: boolean; reason: string; eventId: string }> {
    if (event.type !== "live.direct_say") return { accepted: false, reason: "Invalid type", eventId: event.id };
    
    const { text, forceTopic } = event.payload;
    if (text) {
      this.responder.enqueue(forceTopic ? "topic" : "response", text, "neutral");
      this.summary = `[Live:Dispatch] ${truncateText(text, 50)}`;
      await this.reportReflection("dispatch", text, 8, "high");
    }
    return { accepted: true, reason: "Accepted", eventId: event.id };
  }

  async receiveTopicRequest(event: StelleEvent): Promise<{ accepted: boolean; reason: string; eventId: string }> {
    if (event.type !== "live.topic_request" && event.type !== "live.request") return { accepted: false, reason: "Invalid type", eventId: event.id };
    const { text, authorId } = event.payload;
    if (!text) return { accepted: false, reason: "Empty text", eventId: event.id };

    await this.processBatch([{
      id: event.payload.originMessageId || event.id,
      source: "debug",
      kind: "danmaku",
      priority: "medium",
      receivedAt: event.timestamp || this.context.now(),
      user: { id: authorId, name: event.source === "discord" ? "Discord" : event.source },
      text,
      raw: event.payload,
    }]);
    return { accepted: true, reason: "Routed through live planner", eventId: event.id };
  }

  /**
   * 感知：接收来自前端的实时弹幕
   */
  async receiveLiveEvent(payload: Record<string, unknown>) {
    return this.gateway.receive(payload, (batch) => {
      void this.processBatch(batch).catch(e => console.error("[LiveCursor] Batch processing failed:", e));
    });
  }

  /**
   * 编排：处理缓冲完成的弹幕批次
   */
  private async processBatch(batch: any[]) {
    if (this.isGenerating || batch.length === 0) return;
    this.isGenerating = true;
    this.status = "active";
    const now = this.context.now();

    try {
      const activePolicies = this.policyStore.activePolicies("live");

      // 1. 决策 (Router)
      this.summary = "Designing live strategy...";
      let decision = await this.router.decide(batch, this.responder.getRecentSpeech(), this.currentEmotion, activePolicies);
      
      // 2. 执行工具 (Executor)
      let toolResults: any[] = [];
      if (decision.toolPlan) {
        this.status = "waiting";
        this.summary = `Executing tools: ${decision.toolPlan.calls.map(c => c.tool).join(", ")}`;
        toolResults = await this.executor.execute(decision);
        decision = await this.router.compose({
          batch,
          initialDecision: decision,
          toolResults,
          recentSpeech: this.responder.getRecentSpeech(),
          currentEmotion: this.currentEmotion,
          activePolicies
        });
      }

      // 3. 响应 (Responder)
      if (decision.action !== "drop_noise" && decision.script.trim()) {
        this.status = "active";
        this.currentEmotion = decision.emotion;
        this.responder.enqueue("response", decision.script, decision.emotion);
        this.summary = `[Live:${decision.action}] ${truncateText(decision.script, 50)}`;
        await this.reportReflection(decision.action, decision.script, 4, "medium");
        this.nextThemeAt = this.context.now() + 5000;
      }
    } finally {
      this.isGenerating = false;
      this.status = "idle";
    }
  }

  /**
   * 驱动：主播放循环
   */
  async tick(): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    const now = this.context.now();

    try {
      // 1. 冷场话题生成
      if (now >= this.nextThemeAt && !this.isGenerating) {
        void this.handleIdleTopic();
        this.nextThemeAt = now + 20000; // 预锁
      }

      // 2. 出队播放
      const next = this.responder.dequeue();
      if (!next) return;

      await this.responder.play(next);
      const durationMs = Math.max(2500, next.text.length * 200);
      this.nextThemeAt = now + durationMs + 1000;

    } finally {
      this.tickInFlight = false;
    }
  }

  private async handleIdleTopic() {
    this.isGenerating = true;
    const now = this.context.now();
    try {
      const activePolicies = this.policyStore.activePolicies("live");
      
      const text = await this.router.generateTopic(this.responder.getRecentSpeech(), this.currentEmotion, activePolicies);
      if (text) {
        this.responder.enqueue("topic", text, this.currentEmotion);
        await this.reportReflection("idle_topic", text, 1, "low");
      }
    } finally {
      this.isGenerating = false;
    }
  }

  private async reportReflection(intent: string, summary: string, impactScore: number, salience: any) {
    this.context.eventBus.publish({
      type: "cursor.reflection",
      source: "live",
      id: `refl-${Date.now()}`,
      timestamp: this.context.now(),
      payload: { intent, summary, impactScore, salience }
    });
  }

  snapshot(): CursorSnapshot {
    const stats = this.responder.getQueueStats();
    return {
      id: this.id, kind: this.kind, status: this.status, summary: this.summary,
      state: {
        bufferSize: this.gateway.getBufferSize(),
        topicQueue: stats.topic,
        responseQueue: stats.response,
        currentEmotion: this.currentEmotion
      }
    };
  }
}
