import type { AttentionActivation } from "../types.js";
import type {
  ConsciousnessIdleJudgement,
  ConsciousnessStrategyDecision,
} from "./types.js";

export function planIdleWindowActivations(
  judgement: ConsciousnessIdleJudgement
): AttentionActivation[] {
  const activations: AttentionActivation[] = [];
  const seen = new Set<string>();

  for (const decision of judgement.decisions) {
    const activation = activationFromDecision(decision);
    if (!activation) continue;

    const key = `${activation.cursorId}:${activation.activation.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    activations.push(activation);
  }

  return activations;
}

function activationFromDecision(
  decision: ConsciousnessStrategyDecision
): AttentionActivation | null {
  const timestamp = Date.now();

  if (decision.type === "inspect_cursor") {
    return {
      cursorId: decision.cursorId,
      activation: {
        type: "attention_inspect",
        reason: decision.reason,
        payload: { decision },
        timestamp,
      },
    };
  }

  if (decision.type === "act_through_cursor") {
    return {
      cursorId: decision.cursorId,
      activation: {
        type: decision.activationType,
        reason: decision.reason,
        payload: decision.payload,
        timestamp,
      },
    };
  }

  return null;
}
