import type {
  MinecraftRunRequest,
  MinecraftStrategyJudgeInput,
  MinecraftStrategyJudgeResult,
} from "./types.js";
import { judgeMinecraftRun } from "./judge.js";

export function judgeMinecraftStrategy(
  input: MinecraftStrategyJudgeInput
): MinecraftStrategyJudgeResult {
  const { decision, frame, strategy } = input;

  if (strategy.stepCount >= strategy.maxSteps) {
    return {
      executable: false,
      reason: `Strategy "${strategy.strategyId}" reached maxSteps=${strategy.maxSteps}.`,
      decision: {
        type: "fail",
        reason: `Strategy reached maxSteps=${strategy.maxSteps}.`,
      },
    };
  }

  if (decision.type === "continue") {
    const actionRequest: MinecraftRunRequest = {
      id: `${strategy.strategyId}-judge-${Date.now()}`,
      action: decision.action,
      note: decision.expectation,
      createdAt: Date.now(),
    };
    const actionJudge = judgeMinecraftRun({
      request: actionRequest,
      context: {
        connection: null,
        activeRequest: actionRequest,
        lastObservation: frame.observation,
      },
    });
    return {
      executable: actionJudge.executable,
      reason: actionJudge.executable
        ? `Strategy "${strategy.strategyId}" may continue: ${decision.expectation}`
        : `Strategy action rejected: ${actionJudge.reason}`,
      decision,
      actionJudge,
    };
  }

  if (decision.type === "switch_strategy") {
    return {
      executable: true,
      reason: `Strategy switch accepted: ${decision.reason}`,
      decision,
    };
  }

  if (decision.type === "wait") {
    return {
      executable: true,
      reason: `Strategy waits: ${decision.reason}`,
      decision: {
        ...decision,
        waitMs: Math.max(1000, Math.min(decision.waitMs, 60000)),
      },
    };
  }

  return {
    executable: true,
    reason:
      decision.type === "complete"
        ? `Strategy completed: ${decision.summary}`
        : `Strategy failed: ${decision.reason}`,
    decision,
  };
}
