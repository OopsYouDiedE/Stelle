// === Imports ===
import { moderateLiveEvent, normalizeLiveEvent, type NormalizedLiveEvent } from "../../utils/live_event.js";
import {
  LiveBatchAggregator,
  type DropReason,
  type FlushReason,
  type LiveBatchAggregatorPolicy,
} from "../../live/adapters/live_batch_aggregator.js";
import type { CursorContext } from "../types.js";
import type { LiveEventMetadata } from "../../utils/intent_schema.js";

// === Constants & Types ===
const DEFAULT_BATCH_POLICY: LiveBatchAggregatorPolicy = {
  flushIntervalMs: 500,
  maxWaitMs: 2_000,
  urgentDelayMs: 100,
  maxBatchSize: 20,
  maxBufferSize: 200,
};

/**
 * 模块：Live Gateway (感知与缓冲)
 */
// === Class Definition ===
export class LiveGateway {
  private aggregator?: LiveBatchAggregator;
  private onFlush?: (batch: NormalizedLiveEvent[]) => void;

  constructor(
    private readonly context: CursorContext,
    private readonly policy: LiveBatchAggregatorPolicy = DEFAULT_BATCH_POLICY,
  ) {}

  // === Event Receiving & Moderation ===
  /**
   * 接收原始直播事件并进行初步过滤
   */
  public async receive(
    payload: Record<string, unknown>,
    onFlush: (batch: NormalizedLiveEvent[]) => void,
  ): Promise<{ accepted: boolean; reason: string }> {
    this.onFlush = onFlush;
    const aggregator = this.ensureAggregator();
    const event = normalizeLiveEvent(payload);
    const moderation = moderateLiveEvent(event);
    this.context.eventBus.publish({
      type: "live.moderation.decision",
      source: "live_gateway",
      id: `live-moderation-${event.id}`,
      timestamp: this.context.now(),
      payload: {
        eventId: event.id,
        platform: event.source,
        kind: event.kind,
        allowed: moderation.allowed,
        action: moderation.action,
        reason: moderation.reason,
        category: moderation.category,
        visibleToControlRoom: moderation.visibleToControlRoom ?? !moderation.allowed,
      },
    });

    if (!moderation.allowed) {
      this.publishDropped(event, "moderation_rejected", moderation.reason);
      return { accepted: true, reason: moderation.reason };
    }

    // 基础过滤：噪音识别 (初步尝试启发式识别意图)
    event.metadata = this.detectIntentHeuristically(event);

    if (event.metadata.intent === "unknown" && event.priority !== "high") {
      this.publishDropped(event, "noise_filtered", "noise_filtered");
      return { accepted: true, reason: "noise_filtered" };
    }

    // 礼物、入场、关注等运营型事件由 LiveEngagementService 处理，避免 Cursor 再生成一轮重复台词。
    if (
      event.kind === "gift" ||
      event.kind === "guard" ||
      event.kind === "entrance" ||
      event.kind === "follow" ||
      event.kind === "like"
    ) {
      return { accepted: true, reason: "engagement_event" };
    }

    aggregator.push(event);
    return { accepted: true, reason: "buffered" };
  }

  // === Aggregation & Flushing ===
  private ensureAggregator(): LiveBatchAggregator {
    if (!this.aggregator) {
      this.aggregator = new LiveBatchAggregator(
        this.policy,
        this.context.now,
        (batch, reason) => this.flush(batch, reason),
        (event, reason) => this.publishDropped(event, reason, reason),
      );
    }
    return this.aggregator;
  }

  private flush(batch: NormalizedLiveEvent[], reason: FlushReason): void {
    this.context.eventBus.publish({
      type: "live.batch.flushed",
      source: "live_gateway",
      id: `live-batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: this.context.now(),
      payload: {
        reason,
        size: batch.length,
        oldestEventAgeMs: batch.length ? this.context.now() - Math.min(...batch.map((event) => event.receivedAt)) : 0,
        eventIds: batch.map((event) => event.id),
      },
    });
    this.onFlush?.(batch);
  }

  private publishDropped(event: NormalizedLiveEvent, reason: DropReason, detail: string): void {
    this.context.eventBus.publish({
      type: "live.ingress.dropped",
      source: "live_gateway",
      id: `live-drop-${event.id}`,
      timestamp: this.context.now(),
      payload: {
        event,
        reason,
        detail,
        platform: event.source,
        kind: event.kind,
        eventId: event.id,
      },
    });
  }

  public clear(): void {
    this.aggregator?.clear();
  }

  public getBufferSize(): number {
    return this.aggregator?.getBufferSize() ?? 0;
  }

  // === Heuristics & Utilities ===
  private detectIntentHeuristically(event: NormalizedLiveEvent): LiveEventMetadata {
    const text = event.text.trim();
    if (!text) return { intent: "unknown" };
    if (/^[0-9+]+$|^扣|^签到/u.test(text)) return { intent: "unknown" };
    if (/测试|能看到|在吗/i.test(text)) return { intent: "test_connection" };
    if (/你好|hello|hi|早|午|晚|来了/i.test(text)) return { intent: "greeting" };
    if (/[?？吗呢呀]/.test(text)) return { intent: "question" };
    return { intent: "feedback" }; // Default for other danmaku
  }
}
