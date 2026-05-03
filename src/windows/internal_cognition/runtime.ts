import type { StelleEventBus } from "../../core/event/event_bus.js";
import type { CognitionApi } from "../../capabilities/cognition/api.js";
import type { DecisionPolicyApi } from "../../capabilities/decision_policy/api.js";
import { NarrativeCapability } from "../../capabilities/narrative/api.js";
import type { DecisionCycle, DecisionTrace } from "../../core/execution/cycle_journal.js";
import type { VersionedStore } from "../../core/state/versioned_store.js";

export interface InternalCognitionOptions {
  eventBus: StelleEventBus;
  cognition: CognitionApi;
  decisionPolicy: DecisionPolicyApi;
  narrative: NarrativeCapability;
  versionedStore: VersionedStore;
  agentId: string;
}

/**
 * 内部认知窗口 (Internal Cognition Window)
 * 负责编排决策循环 (Decision Cycle)。
 */
export class InternalCognitionWindow {
  private readonly cycles = new Map<string, DecisionCycle>();
  private readonly traces = new Map<string, DecisionTrace>();

  constructor(private readonly options: InternalCognitionOptions) {
    this.setupSubscriptions();
  }

  private setupSubscriptions(): void {
    // 监听外部触发 (如消息进入)
    this.options.eventBus.subscribe("perception.text.received", (event) => {
      this.startCycle("reply", event.correlationId || event.id, [event]);
    });
    
    // 监听过滤完成
    this.options.eventBus.subscribe("interaction.intent.filter.completed", (event) => {
      this.onFilterCompleted(event.payload as any, event.cycleId!);
    });

    // 监听记忆写入完成，作为循环结束的标志
    this.options.eventBus.subscribe("memory.write.committed", (event) => {
      this.completeCycle(event.cycleId!, "completed");
    });

    // 监听解释请求
    this.options.eventBus.subscribe("cognition.explain.requested", async (event) => {
      const { cycleId } = event.payload as any;
      
      let trace = this.traces.get(cycleId);
      if (!trace) {
        const entry = this.options.versionedStore.readLatest<DecisionTrace>({
          namespace: "trace",
          partitionId: this.options.agentId,
          objectId: cycleId
        });
        trace = entry?.data;
      }

      if (trace) {
        const explanation = await this.options.cognition.explain_choice(trace);
        this.options.eventBus.publish({
          type: "cognition.explain.completed",
          source: "window.internal_cognition",
          correlationId: event.correlationId,
          payload: { cycleId, explanation },
        });
      }
    });
  }

  /**
   * 启动一个新的决策循环
   */
  public async startCycle(lane: DecisionCycle["lane"], correlationId: string, observations: any[]): Promise<string> {
    const cycleId = `cycle-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const startedAt = new Date().toISOString();
    
    const cycle: DecisionCycle = {
      cycleId,
      agentId: this.options.agentId,
      lane,
      correlationId,
      status: "running",
      startedAt,
      watermarks: {}, // MVP: 初始水位为空
    };

    const trace: DecisionTrace = {
      cycleId,
      correlationId,
      actorId: this.options.agentId,
      startedAt,
      watermarks: cycle.watermarks,
      observations: observations.map(o => ({ kind: "event", uri: o.id, summary: o.payload?.text })),
      memoryHits: [],
      candidateIntentIds: [],
      status: "running",
    };

    this.cycles.set(cycleId, cycle);
    this.traces.set(cycleId, trace);
    
    console.log(`[CognitionWindow] Started cycle: ${cycleId} (lane: ${lane})`);

    this.options.eventBus.publish({
      type: "cycle.started",
      source: "window.internal_cognition",
      cycleId,
      correlationId,
      payload: { cycle },
    });

    // 1. 请求记忆检索
    this.options.eventBus.publish({
      type: "memory.retrieve.requested",
      source: "window.internal_cognition",
      cycleId,
      correlationId,
      payload: { query: observations.map(o => o.payload?.text || "").join(" ") },
    });

    // 监听记忆检索完成，继续循环
    const memorySubscription = this.options.eventBus.subscribe("memory.retrieve.completed", async (memEvent) => {
      if (memEvent.cycleId !== cycleId) return;
      memorySubscription(); // 取消订阅

      const memoryHits = (memEvent.payload as any).memories || [];
      trace.memoryHits = memoryHits.map((m: any) => ({ kind: "memory", uri: m.memoryId, summary: m.summary }));

      // 2. 构建认知上下文
      const ctx = await this.options.cognition.build_context({
        cycleId,
        agentId: this.options.agentId,
        lane,
        observations,
        memoryHits,
        watermarks: cycle.watermarks,
      });

      // 3. 生成候选意图
      const intents = await this.options.cognition.generate_intents(ctx);
      trace.candidateIntentIds = intents.map(i => i.intentId);
      
      // 4. 发布意图待过滤事件
      this.options.eventBus.publish({
        type: "cognition.intent.generated",
        source: "window.internal_cognition",
        cycleId,
        correlationId,
        payload: { intents },
      });
    });

    return cycleId;
  }

  private async onFilterCompleted(executables: any[], cycleId: string): Promise<void> {
    const cycle = this.cycles.get(cycleId);
    const trace = this.traces.get(cycleId);
    if (!cycle || !trace) return;

    // 4. 进行最终决策选择
    const selection = await this.options.decisionPolicy.select_decision(executables);

    if (selection) {
      console.log(`[CognitionWindow] Decision selected for cycle ${cycleId}: ${selection.selectedIntentId}`);
      trace.selectedIntentId = selection.selectedIntentId;
      trace.scoreBreakdown = selection.score.breakdown;
      
      // 5. 发布选中决策事件
      this.options.eventBus.publish({
        type: "cognition.decision.selected",
        source: "window.internal_cognition",
        cycleId,
        correlationId: cycle.correlationId,
        payload: { selection },
      });
    } else {
      console.warn(`[CognitionWindow] No executable decision for cycle ${cycleId}`);
      this.completeCycle(cycleId, "failed");
    }
  }

  public completeCycle(cycleId: string, status: DecisionCycle["status"]): void {
    const cycle = this.cycles.get(cycleId);
    const trace = this.traces.get(cycleId);
    if (cycle && trace) {
      cycle.status = status;
      cycle.completedAt = new Date().toISOString();
      trace.status = status === "completed" ? "completed" : "failed";
      
      console.log(`[CognitionWindow] Completed cycle: ${cycleId} (status: ${status})`);
      
      // 持久化 Trace
      this.options.versionedStore.write({
        namespace: "trace",
        partitionId: this.options.agentId,
        objectId: cycleId
      }, trace);

      const fragment = this.options.narrative.generate(trace);

      this.options.eventBus.publish({
        type: "cycle.completed",
        source: "window.internal_cognition",
        cycleId,
        correlationId: cycle.correlationId,
        payload: { cycle, narrative: fragment },
      });
    }
  }
}
