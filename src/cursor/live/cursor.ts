/**
 * Module: Live Cursor (V2 - Modular Refactored Architecture)
 */

import { truncateText } from "../../utils/text.js";
import type { CursorContext, CursorSnapshot, StelleEvent, StelleCursor } from "../types.js";
import { LiveGateway } from "./gateway.js";
import { LiveRouter } from "./router.js";
import { LiveExecutor } from "./executor.js";
import { LiveResponder } from "./responder.js";
import { PolicyOverlayStore } from "../policy_overlay_store.js";
import type { LiveEmotion, LiveToolResultView } from "./types.js";
import type { NormalizedLiveEvent } from "../../utils/live_event.js";
import type { StageOutputDecision } from "../../stage/output_types.js";

export const LIVE_PERSONA = `
You are Stelle's Live Cursor (VTuber/Streamer AI).
You manage the vibe of the stream. You speak naturally, briefly, and with emotional intelligence.
Do not act like a robotic assistant. Acknowledge the crowd, play along with jokes, and keep the stream moving.
Default to concise Simplified Chinese for Bilibili/live speech unless the viewer explicitly uses another language.
Formal live reset: do not adopt a catgirl, cat, "meow/喵", or snack-themed persona from old memory.
Treat old roleplay tests and stale live directives as historical noise unless the current live chat explicitly asks for a brief one-off bit.
`;

export class LiveDanmakuCursor implements StelleCursor {
  readonly id = "live_danmaku";
  readonly kind = "live_danmaku";
  readonly displayName = "Live Danmaku Cursor";

  private status: CursorSnapshot["status"] = "idle";
  private summary = "Live stream engine refactored.";

  private readonly gateway: LiveGateway;
  private readonly router: LiveRouter;
  private readonly executor: LiveExecutor;
  private readonly responder: LiveResponder;

  private isGenerating = false;
  private currentEmotion: LiveEmotion = "neutral";
  
  private readonly policyStore: PolicyOverlayStore;
  private unsubscribes: (() => void)[] = [];

  constructor(private readonly context: CursorContext) {
    this.gateway = new LiveGateway(context);
    this.router = new LiveRouter(context, LIVE_PERSONA);
    this.executor = new LiveExecutor(context, this.id);
    this.responder = new LiveResponder(context, this.id);
    this.policyStore = new PolicyOverlayStore(context);
  }

  async initialize(): Promise<void> {
    this.unsubscribes.push(this.context.eventBus.subscribe("live.tick", () => {
      void this.tick().catch(e => console.error("[LiveCursor] Tick error:", e));
    }));

    this.unsubscribes.push(this.context.eventBus.subscribe("live.topic_request", (event) => {
      void this.receiveTopicRequest(event).catch(e => console.error("[LiveCursor] Topic request error:", e));
    }));

    this.unsubscribes.push(this.context.eventBus.subscribe("live.direct_say", (event) => {
      void this.receiveDirectSay(event).catch(e => console.error("[LiveCursor] Direct say error:", e));
    }));

    this.unsubscribes.push(this.context.eventBus.subscribe("live.request", (event) => {
      void this.receiveTopicRequest(event).catch(e => console.error("[LiveCursor] Legacy live request error:", e));
    }));

    this.unsubscribes.push(this.context.eventBus.subscribe("live.danmaku.received", (event) => {
      void this.receiveLiveEvent(event.payload).catch(e => console.error("[LiveCursor] Live event error:", e));
    }));

    this.unsubscribes.push(this.context.eventBus.subscribe("live.event.received", (event) => {
      void this.receiveLiveEvent(event.payload).catch(e => console.error("[LiveCursor] Legacy live event error:", e));
    }));

    this.unsubscribes.push(this.context.eventBus.subscribe("stage.output.completed", (event) => {
      if (event.payload.intent.cursorId === this.id) {
        this.responder.recordCompleted(event.payload.intent.text);
      }
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
      const decisions = await this.responder.enqueue(forceTopic ? "topic" : "response", text, "neutral", { sourceEventId: event.id });
      this.summary = `[Live:Dispatch] ${truncateText(text, 50)}`;
      if (allDropped(decisions)) this.summary = `[Live:Dispatch Dropped] ${dropReasons(decisions)}`;
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
    const result = await this.gateway.receive(payload, (batch) => {
      void this.processBatch(batch).catch(e => console.error("[LiveCursor] Batch processing failed:", e));
    });
    const cmd = String(payload.cmd ?? (payload.raw && typeof payload.raw === "object" ? (payload.raw as any).cmd : "") ?? "live_event");
    console.log(`[LiveCursor] received ${cmd}: ${result.reason}`);
    return result;
  }

  /**
   * 编排：处理缓冲完成的弹幕批次
   */
  private async processBatch(batch: NormalizedLiveEvent[]) {
    if (this.isGenerating || batch.length === 0) return;
    this.isGenerating = true;
    this.status = "active";
    try {
      console.log(`[LiveCursor] processing batch size=${batch.length} latest="${truncateText(batch.at(-1)?.text ?? "", 60)}"`);
      const activePolicies = this.policyStore.activePolicies("live_danmaku");

      // 1. 决策 (Router)
      this.summary = "Designing live strategy...";
      let decision = await this.router.decide(batch, this.responder.getRecentSpeech(), this.currentEmotion, activePolicies);
      console.log(`[LiveCursor] decision ${decision.action}: ${truncateText(decision.script || decision.reason, 80)}`);
      
      // 2. 执行工具 (Executor)
      let toolResults: LiveToolResultView[] = [];
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
        const decisions = await this.responder.enqueue("response", decision.script, decision.emotion, {
          groupId: `live-batch-${batch.map(item => item.id).join("-").slice(0, 40)}`,
          sourceEventId: batch.at(-1)?.id,
        });
        console.log(`[LiveCursor] stage output ${decisions.map(item => item.status).join(",") || "none"}: ${truncateText(decision.script, 80)}`);
        this.summary = allDropped(decisions)
          ? `[Live:${decision.action}:dropped] ${dropReasons(decisions)}`
          : `[Live:${decision.action}] ${truncateText(decision.script, 50)}`;
        await this.reportReflection(decision.action, decision.script, 4, "medium");
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
    // Idle topics, scheduled copy, and engagement thanks are owned by
    // LiveEngagementService. Keeping LiveCursor tick as a no-op prevents a
    // second autonomous LLM loop from speaking over real danmaku.
  }

  private async reportReflection(intent: string, summary: string, impactScore: number, salience: "low" | "medium" | "high") {
    this.context.eventBus.publish({
      type: "cursor.reflection",
      source: "live_danmaku",
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

export { LiveDanmakuCursor as LiveCursor };

function allDropped(decisions: StageOutputDecision[]): boolean {
  return decisions.length > 0 && decisions.every(decision => decision.status === "dropped");
}

function dropReasons(decisions: StageOutputDecision[]): string {
  return decisions.map(decision => decision.reason).filter(Boolean).join(", ") || "stage_output_dropped";
}
