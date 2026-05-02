import type { PerceptualEvent } from "../../../core/protocol/perceptual_event.js";
import type { Intent } from "../../../core/protocol/intent.js";
import type { RuntimeKernelState } from "./state.js";
import type { KernelDecision } from "./types.js";

export interface KernelPipelineStage<TInput, TOutput> {
  id: string;
  run(input: TInput, state: RuntimeKernelState): Promise<TOutput>;
}

export interface AttentionResult {
  accepted: boolean;
  reason: string;
  salience: number;
}

export interface RuntimeKernelPipeline {
  enrich(event: PerceptualEvent, state: RuntimeKernelState): Promise<PerceptualEvent>;
  evaluateAttention(event: PerceptualEvent, state: RuntimeKernelState): Promise<AttentionResult>;
  plan(event: PerceptualEvent, state: RuntimeKernelState): Promise<Intent[]>;
  planTick?(state: RuntimeKernelState): Promise<Intent[]>;
}
