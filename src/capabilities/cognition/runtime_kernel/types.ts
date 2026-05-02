import type { PerceptualEvent } from "../../../core/protocol/perceptual_event.js";
import type { Intent } from "../../../core/protocol/intent.js";

export type KernelDecision =
  | { kind: "ignored"; reason: string; sourceEventIds: string[] }
  | { kind: "intent"; intent: Intent; reason: string }
  | { kind: "state_updated"; reason: string; sourceEventIds?: string[] };

export interface RuntimeKernelSnapshot {
  state: any;
  activeIntents: string[];
  lastDecision?: KernelDecision;
}

export interface RuntimeCognitionService {
  step(event: PerceptualEvent): Promise<KernelDecision[]>;
  tick(): Promise<KernelDecision[]>;
}
