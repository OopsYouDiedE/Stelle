import type { EventEnvelope } from "../protocol/event_envelope.js";

/**
 * Outbox 模式
 * 确保状态写入与事件发布的一致性：先写数据，再发事件。
 */
export interface Outbox<TPayload = unknown> {
  /**
   * 提交数据并生成待发送的事件。
   * 在实际实现中，这应该是一个原子操作或受事务保护的操作。
   */
  commit(data: TPayload): Promise<EventEnvelope<string, TPayload>>;
  
  /**
   * 发送事件。通常由 Outbox 处理器自动调用。
   */
  dispatch(envelope: EventEnvelope<string, TPayload>): Promise<void>;
}

/**
 * 简单的内存 Outbox 实现，用于 MVP。
 */
export class MemoryOutbox<TPayload> implements Outbox<TPayload> {
  constructor(
    private readonly source: string,
    private readonly eventBus: { publish: (envelope: EventEnvelope<string, TPayload>) => void }
  ) {}

  public async commit(data: TPayload): Promise<EventEnvelope<string, TPayload>> {
    // 在 MVP 中，我们模拟“先存后发”
    const envelope: EventEnvelope<string, TPayload> = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: "outbox.committed", // 这是一个占位，实际应根据业务命名
      ts: new Date().toISOString(),
      source: this.source,
      correlationId: "unknown",
      payload: data,
    };
    
    // TODO: 真正的持久化存储
    return envelope;
  }

  public async dispatch(envelope: EventEnvelope<string, TPayload>): Promise<void> {
    this.eventBus.publish(envelope);
  }
}
