import type { StelleEventBus } from "../../core/event/event_bus.js";
import type { SelfMemoryApi } from "../../capabilities/self_memory/api.js";
import type { ReflectionApi } from "../../capabilities/reflection/api.js";

export interface InternalMemoryOptions {
  eventBus: StelleEventBus;
  selfMemory: SelfMemoryApi;
  reflection: ReflectionApi;
}

/**
 * 内部记忆窗口 (Internal Memory Window)
 * 负责记忆写入和检索。
 */
export class InternalMemoryWindow {
  constructor(private readonly options: InternalMemoryOptions) {
    this.setupSubscriptions();
  }
private setupSubscriptions(): void {
  // 监听动作完成，记录记忆
  this.options.eventBus.subscribe("interaction.action.outcome.committed", async (event) => {
    const outcome = event.payload as any;
    await this.recordMemory(outcome, event.cycleId!, event.correlationId!);
  });

  // 监听记忆检索请求
  this.options.eventBus.subscribe("memory.retrieve.requested", async (event) => {
    const { query } = event.payload as any;
    const memories = await this.options.selfMemory.retrieve({
      agentId: "stelle",
      query,
    });

    this.options.eventBus.publish({
      type: "memory.retrieve.completed",
      source: "window.internal_memory",
      cycleId: event.cycleId,
      correlationId: event.correlationId,
      payload: { memories },
    });
  });

  // 监听反思生成，持久化反思为记忆
  this.options.eventBus.subscribe("reflection.generated", async (event) => {
    const { insights } = event.payload as any;
    for (const insight of insights) {
      await this.options.selfMemory.write({
        summary: insight.summary,
        kind: "reflection",
        importance: Math.round(insight.confidence * 10),
        evidenceRefs: insight.evidenceMemoryIds.map((id: string) => ({ kind: "memory", uri: id })),
      });
    }
  });
}

private async recordMemory(outcome: any, cycleId: string, correlationId: string): Promise<void> {
  console.log(`[MemoryWindow] Recording memory for action outcome: ${outcome.actionId}`);

  const { memoryId, policyResult } = await this.options.selfMemory.write({
    summary: `Action ${outcome.actionId} executed for intent ${outcome.intentId}`,
    kind: "episode",
    importance: 5,
    evidenceRefs: [{ kind: "event", uri: outcome.actionId, summary: "action outcome" }],
  });

  // 发布记忆写入完成事件
  this.options.eventBus.publish({
    type: "memory.write.committed",
    source: "window.internal_memory",
    cycleId,
    correlationId,
    payload: { memoryId, policyResult },
  });

  // 触发反思检查
  const insights = await this.options.reflection.process_memory({
    memoryId,
    agentId: "stelle",
    importance: 5,
    kind: "episode",
  } as any);

  if (insights.length > 0) {
    this.options.eventBus.publish({
      type: "reflection.generated",
      source: "window.internal_memory",
      cycleId,
      correlationId,
      payload: { insights },
    });
  }
}

}
