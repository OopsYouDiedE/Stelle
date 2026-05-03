import type { StelleEventBus } from "../../core/event/event_bus.js";
import type { ContextStateApi } from "../../capabilities/context_state/api.js";
import type { WorldStateApi } from "../../capabilities/world_state/api.js";
import type { WorldSimulation } from "../../capabilities/world_simulation/api.js";

export interface InternalWorldOptions {
  eventBus: StelleEventBus;
  contextState: ContextStateApi;
  worldState: WorldStateApi;
  simulation: WorldSimulation;
}

/**
 * 内部世界窗口 (Internal World Window) - MVP-2
 * 维护轻量级的上下文状态和正式的世界状态。
 */
export class InternalWorldWindow {
  private tickTimer?: NodeJS.Timeout;

  constructor(private readonly options: InternalWorldOptions) {
    this.setupSubscriptions();
    this.startSimulation();
  }

  private setupSubscriptions(): void {
    // 监听决策结果，可能导致上下文变化 (如任务开始/结束)
    this.options.eventBus.subscribe("cognition.decision.selected", (event) => {
      // MVP: 简单地增加版本
      this.options.contextState.update_state({});
    });

    // 监听状态查询请求
    this.options.eventBus.subscribe("world.state.requested", (event) => {
      const state = this.options.contextState.get_snapshot();
      const worldSnapshot = this.options.worldState.get_snapshot();
      
      this.options.eventBus.publish({
        type: "world.state.changed",
        source: "window.internal_world",
        cycleId: event.cycleId,
        correlationId: event.correlationId,
        payload: { contextState: state, worldState: worldSnapshot },
        watermarks: { 
          world: { 
            context: state.version,
            world: worldSnapshot.version
          } 
        }
      });
    });

    // 监听动作提议
    this.options.eventBus.subscribe("world.action.propose", async (event) => {
      const proposal = event.payload as any;
      const result = await this.options.worldState.propose_action(proposal);
      
      this.options.eventBus.publish({
        type: "world.action.completed",
        source: "window.internal_world",
        cycleId: event.cycleId,
        correlationId: event.correlationId,
        payload: result,
      });
    });
  }

  private startSimulation(): void {
    this.tickTimer = setInterval(async () => {
      const state = this.options.worldState.get_snapshot();
      const proposals = this.options.simulation.tick(state);
      
      for (const proposal of proposals) {
        await this.options.worldState.propose_action(proposal);
      }
    }, 10000); // 每 10 秒一个 tick
  }

  public stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
    }
  }
}
