import type { Intent } from "../../../core/protocol/intent.js";
import type { PerceptualEvent } from "../../../core/protocol/perceptual_event.js";
import { DefaultAttentionPolicy } from "./attention_policy.js";
import { DefaultKernelPlanner } from "./planner.js";
import type { AttentionResult, RuntimeKernelPipeline } from "./pipeline.js";

export class DefaultRuntimeKernelPipeline implements RuntimeKernelPipeline {
  constructor(
    private readonly attention = new DefaultAttentionPolicy(),
    private readonly planner = new DefaultKernelPlanner(),
  ) {}

  async enrich(event: PerceptualEvent): Promise<PerceptualEvent> {
    return event;
  }

  async evaluateAttention(event: PerceptualEvent): Promise<AttentionResult> {
    return this.attention.evaluate(event);
  }

  async plan(event: PerceptualEvent): Promise<Intent[]> {
    return this.planner.plan(event);
  }

  async planTick(): Promise<Intent[]> {
    return this.planner.planTick();
  }
}
