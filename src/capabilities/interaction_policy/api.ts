import type { Affordance } from "./affordance.js";
import { IntentFilter, type CandidateIntent, type IntentFilterResult } from "./intent_filter.js";

export interface InteractionPolicyApi {
  /**
   * 解析当前可用的能力/可执行性
   */
  resolve_affordances(context: any): Promise<Affordance[]>;

  /**
   * 过滤候选意图
   */
  filter_intents(intents: CandidateIntent[], availableAffordances: Affordance[]): Promise<IntentFilterResult[]>;
}

export class InteractionPolicyCapability implements InteractionPolicyApi {
  private readonly filter = new IntentFilter();

  public async resolve_affordances(context: any): Promise<Affordance[]> {
    // MVP: 返回一组 Mock Affordances
    return [
      { id: "aff-reply", name: "Send Reply", kind: "reply", description: "Send a text reply to user", isAvailable: true },
      { id: "aff-memory", name: "Write Memory", kind: "memory_write", description: "Record an episode in memory", isAvailable: true },
      { id: "aff-world", name: "World Action", kind: "world_action", description: "Interact with world entities", isAvailable: true },
    ];
  }

  public async filter_intents(intents: CandidateIntent[], availableAffordances: Affordance[]): Promise<IntentFilterResult[]> {
    return this.filter.filter(intents, availableAffordances);
  }
}
