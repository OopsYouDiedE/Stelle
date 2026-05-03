import type { StelleEventBus } from "../../core/event/event_bus.js";
import type { InteractionPolicyApi } from "../../capabilities/interaction_policy/api.js";

export interface InternalInteractionOptions {
  eventBus: StelleEventBus;
  interactionPolicy: InteractionPolicyApi;
}

/**
 * 内部交互窗口 (Internal Interaction Window)
 * 负责意图过滤和动作执行。
 */
export class InternalInteractionWindow {
  constructor(private readonly options: InternalInteractionOptions) {
    this.setupSubscriptions();
  }

  private setupSubscriptions(): void {
    // 监听候选意图生成
    this.options.eventBus.subscribe("cognition.intent.generated", async (event) => {
      const { intents } = event.payload as any;
      const affordances = await this.options.interactionPolicy.resolve_affordances({});
      const filtered = await this.options.interactionPolicy.filter_intents(intents, affordances);
      
      const executables = filtered.filter(f => f.status === "executable");

      this.options.eventBus.publish({
        type: "interaction.intent.filter.completed",
        source: "window.internal_interaction",
        cycleId: event.cycleId,
        correlationId: event.correlationId,
        payload: executables,
      });
    });

    // 监听最终决策选择，执行动作
    this.options.eventBus.subscribe("cognition.decision.selected", async (event) => {
      const { selection } = event.payload as any;
      await this.executeAction(selection, event.cycleId!, event.correlationId!);
    });
  }

  private async executeAction(selection: any, cycleId: string, correlationId: string): Promise<void> {
    console.log(`[InteractionWindow] Executing action for intent: ${selection.selectedIntentId}`);
    
    // MVP: 简单模拟动作执行
    const outcome = {
      status: "success",
      actionId: `act-${Date.now()}`,
      intentId: selection.selectedIntentId,
    };

    // 发布动作执行完成事件
    this.options.eventBus.publish({
      type: "interaction.action.outcome.committed",
      source: "window.internal_interaction",
      cycleId,
      correlationId,
      payload: outcome,
    });
  }
}
