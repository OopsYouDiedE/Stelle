/**
 * Module: Live Cursor (V2 - Modular Refactored Architecture)
 */

import { BridgeGenerator } from "../../live/controller/bridge_generator.js";
import { truncateText } from "../../utils/text.js";
import type { CursorContext, CursorSnapshot, StelleEvent, StelleCursor } from "../types.js";
import { BaseStatefulCursor } from "../base_stateful_cursor.js";
import { LiveGateway } from "./gateway.js";
import { LiveRouter } from "./router.js";
import { LiveExecutor } from "./executor.js";
import { LiveResponder } from "./responder.js";
import { PolicyOverlayStore } from "../policy_overlay_store.js";
import type { LiveEmotion, LiveToolResultView, LiveOutputProposal } from "./types.js";
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

export class LiveDanmakuCursor extends BaseStatefulCursor {
  readonly id = "live_danmaku";
  readonly kind = "live_danmaku";
  readonly displayName = "Live Danmaku Cursor";

  private readonly gateway: LiveGateway;
  private readonly router: LiveRouter;
  private readonly executor: LiveExecutor;
  private readonly responder: LiveResponder;

  private pendingBatches: NormalizedLiveEvent[][] = [];
  private proposalBuffer: LiveOutputProposal[] = [];
  private draining = false;
  private drainPromise?: Promise<void>;
  private batchSequence = 0;
  private readonly maxPendingBatches = 8;
  private readonly maxEventsPerMergedBatch = 30;
  private readonly maxProposalsInBuffer = 5;
  private readonly proposalTtlMs = 45_000;
  private currentEmotion: LiveEmotion = "neutral";

  constructor(context: CursorContext) {
    super(context);
    this.gateway = new LiveGateway(context);
    this.router = new LiveRouter(context, LIVE_PERSONA);
    this.executor = new LiveExecutor(context, this.id);
    this.responder = new LiveResponder(context, this.id);
  }

  protected async onInitialize(): Promise<void> {
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

    this.unsubscribes.push(this.context.eventBus.subscribe("live.event.danmaku", (event) => {
      void this.receiveLiveEvent(event.payload).catch(e => console.error("[LiveCursor] Live event error:", e));
    }));

    this.unsubscribes.push(this.context.eventBus.subscribe("live.danmaku.received", (event) => {
      void this.receiveLiveEvent(event.payload).catch(e => console.error("[LiveCursor] Legacy live event error:", e));
    }));

    this.unsubscribes.push(this.context.eventBus.subscribe("stage.output.completed", (event) => {
      if (event.payload.intent.cursorId === this.id) {
        this.responder.recordCompleted(event.payload.intent.text);
      }
    }));

    this.unsubscribes.push(this.context.eventBus.subscribe("live.output.proposal", (event) => {
      void this.receiveProposal(event).catch(e => console.error("[LiveCursor] Proposal error:", e));
    }));

    this.unsubscribes.push(this.context.eventBus.subscribe("live.topic.transition", (event) => {
      void this.receiveTransition(event).catch(e => console.error("[LiveCursor] Transition error:", e));
    }));
  }

  protected async onStop(): Promise<void> {
    this.gateway.clear();
  }

  private async receiveProposal(event: StelleEvent) {
    if (event.type !== "live.output.proposal") return;
    const { intent, cursorId } = event.payload as { intent: any; cursorId: string };
    const id = event.id;
    const now = this.context.now();
    
    // Prune buffer
    this.proposalBuffer = this.proposalBuffer.filter(p => now - p.receivedAt < this.proposalTtlMs);

    // Prioritize: SuperChat > Gift > Topic > Others
    const source = String(intent.metadata?.source || "");
    const priority = source === "engagement_thanks" && (intent.metadata?.eventKind === "super_chat" || intent.metadata?.eventKind === "guard") ? 100
      : source === "engagement_thanks" && intent.metadata?.eventKind === "gift" ? 80
      : source === "live_program" ? 60
      : 40;

    const proposal: LiveOutputProposal = {
      id: id || `prop-${now}-${Math.random().toString(36).slice(2, 7)}`,
      cursorId: cursorId || "live_stage_director",
      intent,
      receivedAt: now,
      priority,
    };

    this.proposalBuffer.push(proposal);
    this.proposalBuffer.sort((a, b) => b.priority - a.priority);
    
    if (this.proposalBuffer.length > this.maxProposalsInBuffer) {
      this.proposalBuffer.pop();
    }

    console.log(`[LiveCursor] Buffered proposal ${proposal.id} (Priority: ${priority}) total=${this.proposalBuffer.length}`);

    // If super idle or super urgent, trigger a batch processing if nothing is happening
    if (!this.draining && (priority >= 100 || this.pendingBatches.length === 0)) {
      void this.processBatch([]).catch(e => console.error("[LiveCursor] Batch processing failed:", e));
    }
  }

  private async receiveTransition(event: StelleEvent) {
    if (event.type !== "live.topic.transition") return;
    const { title, fromPhase, toPhase } = event.payload;
    const text = BridgeGenerator.generate(title, fromPhase, toPhase);

    // Transitions are strategic proposals
    await this.receiveProposal({
      type: "live.output.proposal",
      source: "stage_director",
      id: `prop-trans-${this.context.now()}`,
      timestamp: this.context.now(),
      payload: {
        intent: {
          lane: "topic_hosting",
          priority: 55,
          salience: "medium",
          text,
          summary: text,
          topic: title,
          ttlMs: 30_000,
          interrupt: "soft",
          metadata: { source: "topic_transition", fromPhase, toPhase },
        },
        cursorId: "live_stage_director",
      }
    } as any);
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
      if (this.allDropped(decisions)) this.summary = `[Live:Dispatch Dropped] ${this.getDropReasons(decisions)}`;
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
    if (batch.length > 0) this.enqueueBatch(batch);
    return this.drainBatches();
  }

  private enqueueBatch(batch: NormalizedLiveEvent[]): void {
    this.pendingBatches.push(batch);
    if (this.pendingBatches.length <= this.maxPendingBatches) return;

    const before = this.pendingBatches.length;
    this.pendingBatches = this.coalescePendingBatches(this.pendingBatches);
    console.warn(`[LiveCursor] pending batch queue coalesced ${before}->${this.pendingBatches.length}`);
  }

  private async drainBatches(): Promise<void> {
    if (this.draining) return this.drainPromise;

    this.draining = true;
    this.status = "active";
    this.drainPromise = (async () => {
      try {
        while (this.pendingBatches.length > 0 || this.proposalBuffer.length > 0) {
          const batch = this.takeNextBatch();
          // If batch is empty but we have proposals, we proceed with an empty batch to address proposals
          await this.handleBatch(batch);
          
          // Small delay between batches if we just processed one
          if (this.pendingBatches.length > 0 || this.proposalBuffer.length > 0) {
            await new Promise(r => setTimeout(r, 500));
          }
        }
      } finally {
        this.draining = false;
        this.drainPromise = undefined;
        this.status = "idle";
      }
    })();
    return this.drainPromise;
  }

  private takeNextBatch(): NormalizedLiveEvent[] {
    const first = this.pendingBatches.shift() ?? [];

    while (
      first.length < this.maxEventsPerMergedBatch &&
      this.pendingBatches.length > 0 &&
      !this.containsUrgentEvent(this.pendingBatches[0])
    ) {
      const next = this.pendingBatches.shift() ?? [];
      first.push(...next);
    }

    if (first.length <= this.maxEventsPerMergedBatch) return first;

    const overflow = first.splice(this.maxEventsPerMergedBatch);
    if (overflow.length > 0) this.pendingBatches.unshift(overflow);
    return first;
  }

  private coalescePendingBatches(batches: NormalizedLiveEvent[][]): NormalizedLiveEvent[][] {
    const result: NormalizedLiveEvent[][] = [];
    let ordinary: NormalizedLiveEvent[] = [];

    const flushOrdinary = () => {
      while (ordinary.length > 0) {
        result.push(ordinary.splice(0, this.maxEventsPerMergedBatch));
      }
    };

    for (const batch of batches) {
      if (this.containsUrgentEvent(batch)) {
        flushOrdinary();
        result.push(batch);
        continue;
      }
      ordinary.push(...batch);
      if (ordinary.length >= this.maxEventsPerMergedBatch) flushOrdinary();
    }

    flushOrdinary();
    return result;
  }

  private containsUrgentEvent(batch: NormalizedLiveEvent[] | undefined): boolean {
    return Boolean(batch?.some(event => event.kind === "super_chat" || event.kind === "guard" || event.kind === "gift" || event.priority === "high"));
  }

  private async handleBatch(batch: NormalizedLiveEvent[]): Promise<void> {
    const events = batch.filter(Boolean);
    const now = this.context.now();
    
    // Refresh proposals
    this.proposalBuffer = this.proposalBuffer.filter(p => now - p.receivedAt < this.proposalTtlMs);
    
    if (events.length === 0 && this.proposalBuffer.length === 0) return;

    const startedAt = this.context.now();
    const batchId = `live-batch-${++this.batchSequence}`;
    const oldestAgeMs = events.length > 0 ? startedAt - Math.min(...events.map(event => event.receivedAt)) : 0;

    try {
      console.log(`[LiveCursor] processing ${batchId} size=${events.length} proposals=${this.proposalBuffer.length} oldestAgeMs=${oldestAgeMs}`);
      const activePolicies = this.policyStore.activePolicies("live_danmaku");

      // 1. 决策 (Router)
      this.summary = "Designing live strategy...";
      let decision = await this.router.decide(events, this.responder.getRecentSpeech(), this.currentEmotion, activePolicies, this.proposalBuffer);
      console.log(`[LiveCursor] decision ${decision.action}: ${truncateText(decision.script || decision.reason, 80)}`);

      // 2. 执行工具 (Executor)
      let toolResults: LiveToolResultView[] = [];
      if (decision.toolPlan) {
        this.status = "waiting";
        this.summary = `Executing tools: ${decision.toolPlan.calls.map(c => c.tool).join(", ")}`;
        toolResults = await this.executor.execute(decision);
        decision = await this.router.compose({
          batch: events,
          initialDecision: decision,
          toolResults,
          recentSpeech: this.responder.getRecentSpeech(),
          currentEmotion: this.currentEmotion,
          activePolicies,
          proposals: this.proposalBuffer
        });
      }

      // 3. 响应 (Responder)
      if (decision.action !== "drop_noise" && decision.script.trim()) {
        this.status = "active";
        this.currentEmotion = decision.emotion;
        const decisions = await this.responder.enqueue("response", decision.script, decision.emotion, {
          groupId: `${batchId}-${events.map(item => item.id).join("-").slice(0, 40)}`,
          sourceEventId: events.at(-1)?.id,
        });
        
        // Handle consumed proposals
        if (decision.consumedProposalIds?.length) {
          console.log(`[LiveCursor] consumed proposals: ${decision.consumedProposalIds.join(", ")}`);
          this.proposalBuffer = this.proposalBuffer.filter(p => !decision.consumedProposalIds?.includes(p.id));
        }

        console.log(`[LiveCursor] stage output ${decisions.map(item => item.status).join(",") || "none"}: ${truncateText(decision.script, 80)}`);
        this.summary = this.allDropped(decisions)
          ? `[Live:${decision.action}:dropped] ${this.getDropReasons(decisions)}`
          : `[Live:${decision.action}] ${truncateText(decision.script, 50)}`;
        await this.reportReflection(decision.action, decision.script, 4, "medium");
      } else {
        // If LLM dropped but there are still high priority proposals, maybe it made a mistake or we should try to execute one verbatim
        await this.maybeExecuteFallbackProposal(decision);
      }
    } catch (error) {
      console.error("[LiveDanmakuCursor] batch failed", {
        error,
        batchId,
        batchSize: events.length,
        oldestAgeMs,
      });
    }
  }

  private async maybeExecuteFallbackProposal(decision: any) {
    if (this.proposalBuffer.length === 0) return;
    const top = this.proposalBuffer[0];
    
    // If it's a super urgent proposal (SuperChat) and we dropped the noise, we MUST execute it
    if (top.priority >= 100) {
      console.log(`[LiveCursor] executing fallback urgent proposal: ${top.id}`);
      const decisions = await this.responder.enqueue("response", top.intent.text, "happy", {
        sourceEventId: top.id,
        metadata: top.intent.metadata
      });
      this.proposalBuffer.shift();
      this.summary = `[Live:Fallback] ${truncateText(top.intent.text, 50)}`;
    }
  }

  /**
   * 驱动：主播放循环
   */
  async tick(): Promise<void> {
    // If idle and we have proposals, trigger a drain
    if (!this.draining && this.proposalBuffer.length > 0) {
      void this.drainBatches().catch(e => console.error("[LiveCursor] Idle proposal drain failed:", e));
    }
  }

  snapshot(): CursorSnapshot {
    const stage = this.context.stageOutput.snapshot();
    return {
      id: this.id, kind: this.kind, status: this.status, summary: this.summary,
      state: {
        bufferSize: this.gateway.getBufferSize(),
        proposalBufferSize: this.proposalBuffer.length,
        stageStatus: stage.status,
        stageQueueLength: stage.queueLength,
        stageCurrentOutputId: stage.currentOutputId,
        stageCurrentLane: stage.currentLane,
        currentEmotion: this.currentEmotion
      }
    };
  }
}

export { LiveDanmakuCursor as LiveCursor };

