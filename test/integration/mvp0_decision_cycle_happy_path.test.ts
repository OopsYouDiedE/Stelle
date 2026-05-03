import { describe, it, expect, vi } from "vitest";
import { StelleEventBus } from "../../src/core/event/event_bus.js";
import { InternalCognitionWindow } from "../../src/windows/internal_cognition/runtime.js";
import { InternalInteractionWindow } from "../../src/windows/internal_interaction/runtime.js";
import { InternalMemoryWindow } from "../../src/windows/internal_memory/runtime.js";
import { CognitionCapability } from "../../src/capabilities/cognition/api.js";
import { InteractionPolicyCapability } from "../../src/capabilities/interaction_policy/api.js";
import { DecisionPolicyCapability } from "../../src/capabilities/decision_policy/api.js";
import { SelfMemoryCapability } from "../../src/capabilities/self_memory/api.js";
import { NarrativeCapability } from "../../src/capabilities/narrative/api.js";
import { ReflectionCapability } from "../../src/capabilities/reflection/api.js";
import { VersionedStore } from "../../src/core/state/versioned_store.js";

describe("MVP-0 Decision Cycle Integration", () => {
  it("should complete a full loop from perception to memory commit", async () => {
    const eventBus = new StelleEventBus();
    const cognition = new CognitionCapability();
    const interactionPolicy = new InteractionPolicyCapability();
    const decisionPolicy = new DecisionPolicyCapability();
    const selfMemory = new SelfMemoryCapability();
    const narrative = new NarrativeCapability();
    const reflection = new ReflectionCapability();
    const versionedStore = new VersionedStore();

    const cogWin = new InternalCognitionWindow({
      eventBus,
      cognition,
      decisionPolicy,
      narrative,
      versionedStore,
      agentId: "stelle",
    });

    const intWin = new InternalInteractionWindow({
      eventBus,
      interactionPolicy,
    });

    const memWin = new InternalMemoryWindow({
      eventBus,
      selfMemory,
      reflection,
    });

    // 监控 cycle.completed 事件
    const completedPromise = new Promise((resolve) => {
      eventBus.subscribe("cycle.completed", (event) => {
        resolve(event);
      });
    });

    // 模拟收到消息
    eventBus.publish({
      type: "perception.text.received",
      source: "test",
      id: "msg-001",
      correlationId: "corr-001",
      payload: { text: "Hello Stelle!" },
    });

    // 等待循环完成
    const completionEvent = await completedPromise as any;

    expect(completionEvent.cycleId).toBeDefined();
    expect(completionEvent.payload.cycle.status).toBe("completed");
    expect(completionEvent.correlationId).toBe("corr-001");
    
    console.log("Decision Cycle completed successfully!");
    console.log("Cycle ID:", completionEvent.cycleId);
  });
});
