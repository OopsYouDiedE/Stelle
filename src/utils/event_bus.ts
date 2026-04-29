import { EventEmitter } from "node:events";
import { StelleEventSchema, type StelleEvent, type StelleEventType } from "./event_schema.js";

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

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  /**
   * 发布一个事件 (带元数据注入和校验)
   */
  public publish(
    input: { type: StelleEventType; source: string } & Record<string, unknown>
  ): void {
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

    const event = result.data as StelleEvent;

    // 记录历史 (环形缓冲区)
    this.history.push(event);
    if (this.history.length > this.MAX_HISTORY) {
      this.history.shift();
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
    listener: (event: T extends StelleEventType ? Extract<StelleEvent, { type: T }> : StelleEvent) => void
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

  /**
   * 清空所有监听器 (用于重载/关闭)
   */
  public clear(): void {
    this.emitter.removeAllListeners();
  }
}
