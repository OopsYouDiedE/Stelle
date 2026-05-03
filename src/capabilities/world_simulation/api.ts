import type { WorldSnapshot, ActionProposal } from "../world_state/schema.js";

/**
 * 模拟规则 (Simulation Rule)
 */
export interface SimulationRule {
  name: string;
  apply(state: WorldSnapshot): ActionProposal[];
}

/**
 * 世界模拟 (World Simulation)
 */
export class WorldSimulation {
  private rules: SimulationRule[] = [];

  public addRule(rule: SimulationRule): void {
    this.rules.push(rule);
  }

  /**
   * 模拟一个“嘀嗒” (Tick)，产生由于物理或逻辑规则自动触发的动作。
   */
  public tick(state: WorldSnapshot): ActionProposal[] {
    const proposals: ActionProposal[] = [];
    for (const rule of this.rules) {
      proposals.push(...rule.apply(state));
    }
    return proposals;
  }
}
