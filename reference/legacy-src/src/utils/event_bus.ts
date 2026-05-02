// === Imports ===
import { EventEmitter } from "node:events";
import { StelleEventSchema, type StelleEvent, type StelleEventType } from "./event_schema.js";

export interface EventBackpressureOptions {
  maxPending?: number;
  dropWhenFull?: "oldest" | "newest";
  coalesceLatest?: boolean;
}

export interface EventBackpressureStat {
  type: StelleEventType | "*";
  listenerId: number;
  pending: number;
  running: boolean;
  processed: number;
  dropped: number;
  coalesced: number;
}

type EventListener<T extends StelleEventType | "*"> = (
  event: T extends StelleEventType ? Extract<StelleEvent, { type: T }> : StelleEvent,
) => unknown | Promise<unknown>;

interface ListenerEntry {
  id: number;
  type: StelleEventType | "*";
  listener: EventListener<any>;
  options?: Required<EventBackpressureOptions>;
  queue: StelleEvent[];
  running: boolean;
  processed: number;
  dropped: number;
  coalesced: number;
}

const HIGH_FREQUENCY_DEFAULTS = new Set<StelleEventType>(["live.danmaku.received", "live.batch.flushed"]);

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
  private readonly MAX_HISTORY = 100;
  private readonly listeners = new Map<StelleEventType | "*", ListenerEntry[]>();
  private nextListenerId = 1;

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  /**
   * 发布一个事件 (带元数据注入和校验)
   */
  public publish(input: { type: StelleEventType; source: string } & Record<string, unknown>): void {
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
    if (this.history.length > this.MAX_HISTORY) {
      this.history.shift();
    }

    // 分发：支持精确匹配和通配符监听
    this.dispatch(event.type, event);
    this.dispatch("*", event);
  }

  /**
   * 订阅特定类型的事件
   */
  public subscribe<T extends StelleEventType | "*">(
    type: T,
    listener: EventListener<T>,
    options?: EventBackpressureOptions,
  ): () => void {
    const entry: ListenerEntry = {
      id: this.nextListenerId++,
      type,
      listener,
      options: normalizeBackpressureOptions(type, options),
      queue: [],
      running: false,
      processed: 0,
      dropped: 0,
      coalesced: 0,
    };
    const entries = this.listeners.get(type) ?? [];
    entries.push(entry);
    this.listeners.set(type, entries);
    return () => {
      const current = this.listeners.get(type) ?? [];
      const next = current.filter((item) => item !== entry);
      if (next.length) this.listeners.set(type, next);
      else this.listeners.delete(type);
    };
  }

  /**
   * 获取最近的事件流快照 (用于 Debug/观测)
   */
  public getHistory(): StelleEvent[] {
    return [...this.history];
  }

  public getBackpressureStats(): EventBackpressureStat[] {
    return [...this.listeners.values()]
      .flat()
      .filter((entry) => entry.options || entry.dropped || entry.coalesced || entry.queue.length)
      .map((entry) => ({
        type: entry.type,
        listenerId: entry.id,
        pending: entry.queue.length,
        running: entry.running,
        processed: entry.processed,
        dropped: entry.dropped,
        coalesced: entry.coalesced,
      }));
  }

  public async flushBackpressure(type?: StelleEventType | "*"): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const entries = [...this.listeners.values()]
        .flat()
        .filter((entry) => type === undefined || entry.type === type);
      if (entries.every((entry) => !entry.running && entry.queue.length === 0)) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  /**
   * 清空所有监听器 (用于重载/关闭)
   */
  public clear(): void {
    this.emitter.removeAllListeners();
    this.listeners.clear();
  }

  private dispatch(type: StelleEventType | "*", event: StelleEvent): void {
    for (const entry of this.listeners.get(type) ?? []) {
      if (entry.options) {
        this.enqueue(entry, event);
        continue;
      }
      void this.invoke(entry, event);
    }
  }

  private enqueue(entry: ListenerEntry, event: StelleEvent): void {
    const options = entry.options;
    if (!options) return;

    if (options.coalesceLatest && entry.queue.length > 0) {
      entry.queue.splice(0, entry.queue.length, event);
      entry.coalesced += 1;
      void this.drain(entry);
      return;
    }

    if (entry.queue.length >= options.maxPending) {
      if (options.dropWhenFull === "newest") {
        entry.dropped += 1;
        return;
      }
      entry.queue.shift();
      entry.dropped += 1;
    }

    entry.queue.push(event);
    void this.drain(entry);
  }

  private async drain(entry: ListenerEntry): Promise<void> {
    if (entry.running) return;
    entry.running = true;
    try {
      while (entry.queue.length > 0) {
        const event = entry.queue.shift();
        if (event) await this.invoke(entry, event);
      }
    } finally {
      entry.running = false;
    }
  }

  private async invoke(entry: ListenerEntry, event: StelleEvent): Promise<void> {
    try {
      await entry.listener(event as any);
      entry.processed += 1;
    } catch (error) {
      console.error(`[EventBus] listener failed for ${entry.type}:`, error);
    }
  }
}

function normalizeBackpressureOptions(
  type: StelleEventType | "*",
  options?: EventBackpressureOptions,
): Required<EventBackpressureOptions> | undefined {
  if (!options && (type === "*" || !HIGH_FREQUENCY_DEFAULTS.has(type))) return undefined;
  return {
    maxPending: Math.max(1, options?.maxPending ?? 1),
    dropWhenFull: options?.dropWhenFull ?? "oldest",
    coalesceLatest: options?.coalesceLatest ?? HIGH_FREQUENCY_DEFAULTS.has(type as StelleEventType),
  };
}
