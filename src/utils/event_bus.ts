// === Imports ===
import { EventEmitter } from "node:events";
import { StelleEventSchema, type StelleEvent, type StelleEventType } from "./event_schema.js";
import type { BackpressureStatus, QueueOverflowPolicy } from "../core/protocol/backpressure.js";

// === Core Logic ===

/**
 * 模块：Stelle 增强型事件总线
 *
 * 核心改进：
 * 1. 强类型校验：基于 Zod Schema 确保事件结构符合协议。
 * 2. 自动元数据注入：发布时自动补齐 ID、时间戳。
 * 3. 运行时观测：内置环形缓冲区 (History)，可追踪最近发生的事件。
 * 4. 隔离性：实例化的 EventBus，支持测试隔离和多 Runtime 运行。
 */
export class StelleEventBus {
  private readonly emitter = new EventEmitter();
  private readonly history: StelleEvent[] = [];
  private readonly maxHistory: number;
  private readonly maxPayloadBytes: number;
  private droppedItems = 0;
  private readonly overflow: QueueOverflowPolicy;

  constructor(options: { maxHistory?: number; maxPayloadBytes?: number; overflow?: QueueOverflowPolicy } = {}) {
    this.emitter.setMaxListeners(50);
    this.maxHistory = options.maxHistory ?? 100;
    this.maxPayloadBytes = options.maxPayloadBytes ?? 64 * 1024;
    this.overflow = options.overflow ?? "drop_oldest";
  }

  /**
   * 发布一个事件 (带元数据注入和校验)
   */
  public publish(input: { type: StelleEventType; source: string } & Record<string, unknown>): void {
    const payloadBytes = estimatePayloadBytes(input.payload);
    if (payloadBytes > this.maxPayloadBytes) {
      this.droppedItems += 1;
      console.warn(
        `[EventBus] Oversized payload rejected: type=${input.type} sizeBytes=${payloadBytes} maxBytes=${this.maxPayloadBytes}`,
      );
      return;
    }

    const eventData = {
      ...input,
      id: (input.id as string) || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: (input.timestamp as number) || Date.now(),
    };

    // 运行时强校验
    const result = StelleEventSchema.safeParse(eventData);
    if (!result.success) {
      console.error("[EventBus] Invalid event rejected:", result.error.format());
      return;
    }

    const event = result.data; // Type is already StelleEvent from schema

    // 记录历史 (环形缓冲区)
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      if (this.overflow === "reject") {
        this.history.pop();
        this.droppedItems += 1;
        return;
      }
      this.history.shift();
      this.droppedItems += 1;
    }

    // 分发：支持精确匹配和通配符监听
    this.emitter.emit(event.type, event);
    this.emitter.emit("*", event);
  }

  /**
   * 订阅特定类型的事件
   */
  public subscribe<T extends StelleEventType>(
    type: T | "*",
    listener: (event: T extends StelleEventType ? Extract<StelleEvent, { type: T }> : StelleEvent) => void,
  ): () => void {
    const wrapper = (event: StelleEvent) => listener(event as any);
    this.emitter.on(type, wrapper);
    return () => {
      this.emitter.off(type, wrapper);
    };
  }

  /**
   * 获取最近的事件流快照 (用于 Debug/观测)
   */
  public getHistory(): StelleEvent[] {
    return [...this.history];
  }

  public getBackpressureStatus(consumerId = "event_bus.history"): BackpressureStatus {
    return {
      queueId: "event_bus.history",
      consumerId,
      bufferedItems: this.history.length,
      droppedItems: this.droppedItems,
      lagMs: 0,
      recommendedAction: this.history.length >= this.maxHistory ? "drop_low_priority" : "ok",
    };
  }

  /**
   * 清空所有监听器 (用于重载/关闭)
   */
  public clear(): void {
    this.emitter.removeAllListeners();
  }
}

function estimatePayloadBytes(payload: unknown): number {
  if (payload === undefined || payload === null) return 0;
  if (payload instanceof Uint8Array) return payload.byteLength;
  if (typeof payload === "string") return Buffer.byteLength(payload, "utf8");
  try {
    return Buffer.byteLength(JSON.stringify(payload), "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}
