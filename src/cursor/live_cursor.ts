/**
 * Module: Live Cursor (V2 - Modular Refactored Architecture)
 */

import { truncateText } from "../utils/text.js";
import type { CursorContext, CursorSnapshot, StelleEvent, StelleCursor } from "./types.js";
import { LiveGateway } from "./live/gateway.js";
import { LiveRouter } from "./live/router.js";
import { LiveResponder } from "./live/responder.js";
import type { LiveAction, LiveEmotion } from "./live/types.js";

export const LIVE_PERSONA = `
You are Stelle's Live Cursor (VTuber/Streamer AI).
You manage the vibe of the stream. You speak naturally, briefly, and with emotional intelligence.
Do not act like a robotic assistant. Acknowledge the crowd, play along with jokes, and keep the stream moving.
`;

const LIVE_CURSOR_TOOLS = [
  "basic.datetime", "memory.read_long_term", "memory.write_recent", "memory.search", "memory.propose_write",
  "search.web_search", "search.web_read", "live.status", "live.set_caption", "live.stream_caption",
  "live.push_event", "live.stream_tts_caption", "live.trigger_motion", "live.set_expression",
  "obs.status", "tts.kokoro_speech",
] as const;

export class LiveCursor implements StelleCursor {
  readonly id = "live";
  readonly kind = "live";
  readonly displayName = "Live Cursor";

  private status: CursorSnapshot["status"] = "idle";
  private summary = "Live stream engine refactored.";

  private readonly gateway: LiveGateway;
  private readonly router: LiveRouter;
  private readonly responder: LiveResponder;

  private nextThemeAt = 0;
  private isGenerating = false;
  private tickInFlight = false;
  private currentEmotion: LiveEmotion = "neutral";
  
  private policyOverlay: string[] = [];
  private unsubscribes: (() => void)[] = [];

  constructor(private readonly context: CursorContext) {
    this.gateway = new LiveGateway(context);
    this.router = new LiveRouter(context, LIVE_PERSONA);
    this.responder = new LiveResponder(context, [...LIVE_CURSOR_TOOLS]);
  }

  async initialize(): Promise<void> {
    this.unsubscribes.push(this.context.eventBus.subscribe("live.tick", () => {
      void this.tick().catch(e => console.error("[LiveCursor] Tick error:", e));
    }));

    this.unsubscribes.push(this.context.eventBus.subscribe("live.request", (event: Extract<StelleEvent, { type: "live.request" }>) => {
      void this.receiveDispatch(event).catch(e => console.error("[LiveCursor] Dispatch error:", e));
    }));

    this.unsubscribes.push(this.context.eventBus.subscribe("cursor.directive", (event) => {
      if (event.payload.target === "live" || event.payload.target === "global") {
        const instruction = String(event.payload.parameters.instruction || "");
        if (instruction) {
          this.policyOverlay.push(instruction);
          setTimeout(() => { this.policyOverlay = this.policyOverlay.filter(i => i !== instruction); }, 30 * 60 * 1000);
        }
      }
    }));
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
    this.gateway.clear();
  }

  /**
   * 路由：接收外部强推指令 (通常来自系统或调试)
   */
  async receiveDispatch(event: StelleEvent): Promise<{ accepted: boolean; reason: string; eventId: string }> {
    if (event.type !== "live.request") return { accepted: false, reason: "Invalid type", eventId: event.id };
    
    const { text, forceTopic } = event.payload;
    if (text) {
      this.responder.enqueue(forceTopic ? "topic" : "response", text, "neutral");
      this.summary = `[Live:Dispatch] ${truncateText(text, 50)}`;
      await this.reportReflection("dispatch", text, 8, "high");
    }
    return { accepted: true, reason: "Accepted", eventId: event.id };
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

    try {
      const decision = await this.router.decide(batch, this.responder.getRecentSpeech(), this.currentEmotion, this.policyOverlay);
      
      if (decision.action !== "drop_noise" && decision.script.trim()) {
        this.currentEmotion = decision.emotion;
        this.responder.enqueue("response", decision.script, decision.emotion);
        this.summary = `[Live:${decision.action}] ${truncateText(decision.script, 50)}`;
        await this.reportReflection(decision.action, decision.script, 4, "medium");
        this.nextThemeAt = this.context.now() + 5000; // 推迟下一次自动话题
      }
    } finally {
      this.isGenerating = false;
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
    try {
      const text = await this.router.generateTopic(this.responder.getRecentSpeech(), this.currentEmotion, this.policyOverlay);
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
