import { describe, it, expect, vi } from "vitest";
import { StelleEventBus } from "../../src/core/event/event_bus.js";
import { InternalCognitionWindow } from "../../src/windows/internal_cognition/runtime.js";
import { InternalInteractionWindow } from "../../src/windows/internal_interaction/runtime.js";
import { InternalMemoryWindow } from "../../src/windows/internal_memory/runtime.js";
import { InternalWorldWindow } from "../../src/windows/internal_world/runtime.js";
import { CognitionCapability } from "../../src/capabilities/cognition/api.js";
import { InteractionPolicyCapability } from "../../src/capabilities/interaction_policy/api.js";
import { DecisionPolicyCapability } from "../../src/capabilities/decision_policy/api.js";
import { SelfMemoryCapability } from "../../src/capabilities/self_memory/api.js";
import { ContextStateCapability } from "../../src/capabilities/context_state/api.js";
import { WorldStateCapability } from "../../src/capabilities/world_state/api.js";
import { WorldSimulation } from "../../src/capabilities/world_simulation/api.js";
import { NarrativeCapability } from "../../src/capabilities/narrative/api.js";
import { ReflectionCapability } from "../../src/capabilities/reflection/api.js";
import { VersionedStore } from "../../src/core/state/versioned_store.js";

describe("Short-term Planning & Illegal Action Test", () => {
  it("should block an intent to move an item to a non-existent parent and record the failure in trace", async () => {
    const eventBus = new StelleEventBus();
    const cognition = new CognitionCapability();
    const interactionPolicy = new InteractionPolicyCapability();
    const decisionPolicy = new DecisionPolicyCapability();
    const selfMemory = new SelfMemoryCapability();
    const contextState = new ContextStateCapability();
    const worldState = new WorldStateCapability({
      version: 1,
      scenes: ["stelle_room"],
      entities: {
        "stelle-001": {
          entityId: "stelle-001",
          kind: "character",
          schemaVersion: "1.0.0",
          name: "Stelle",
          state: {},
          location: { sceneId: "stelle_room" },
        },
        "coffee-cup": {
          entityId: "coffee-cup",
          kind: "item",
          schemaVersion: "1.0.0",
          name: "Coffee Cup",
          state: { isMovable: true },
          location: { sceneId: "stelle_room", position: { x: 5, y: 1, z: 0 } },
        }
      }
    });
    const simulation = new WorldSimulation();
    const narrative = new NarrativeCapability();
    const reflection = new ReflectionCapability();
    const versionedStore = new VersionedStore();

    // 实例化所有 Windows
    const cogWin = new InternalCognitionWindow({ eventBus, cognition, decisionPolicy, narrative, versionedStore, agentId: "stelle-001" });
    const intWin = new InternalInteractionWindow({ eventBus, interactionPolicy });
    const memWin = new InternalMemoryWindow({ eventBus, selfMemory, reflection });
    const worldWin = new InternalWorldWindow({ eventBus, contextState, worldState, simulation });

    // 1. 模拟认知产生一个“非法”意图：将咖啡杯放入一个不存在的“黑洞”
    // 我们手动触发 startCycle 并注入特定观察，迫使 IntentGenerator (Mock) 生成世界动作
    // 注意：目前的 IntentGenerator 是简单模拟，我们通过劫持 generate_intents 来模拟一个非法意图
    const spy = vi.spyOn(cognition, 'generate_intents').mockResolvedValue([{
      intentId: "intent-illegal-move",
      actorId: "stelle-001",
      scope: "world",
      summary: "Put the coffee cup into the void",
      desiredOutcome: "Cup is stored in a non-existent dimension",
      evidenceRefs: [],
      justification: "I want to see if the world logic is solid.",
      targetRefs: [{ kind: "item", id: "coffee-cup" }]
    }]);

    // 2. 模拟 Interaction Window 执行该意图时产生的 Proposal
    // 我们需要确保 Interaction Window 真的发出了这个 Proposal，
    // 并且 World Window 拒绝了它。
    
    // 监控 world.action.completed
    const actionResultPromise = new Promise((resolve) => {
      eventBus.subscribe("world.action.completed", (event) => {
        resolve(event.payload);
      });
    });

    // 监控 cycle.completed
    const cycleCompletedPromise = new Promise((resolve) => {
      eventBus.subscribe("cycle.completed", (event) => {
        resolve(event.payload);
      });
    });

    // 我们需要稍微修改 InternalInteractionWindow 的 executeAction 逻辑来处理 "world" scope 的意图
    // 目前它的 executeAction 是 mock 的，我们需要让它针对 "world" scope 发送 world.action.propose
    // 为了不改动核心代码，我们在这里手动模拟 Interaction Window 转发 Proposal 的行为
    eventBus.subscribe("cognition.decision.selected", (event) => {
      const { selection } = event.payload as any;
      if (selection.selectedIntentId === "intent-illegal-move") {
        eventBus.publish({
          type: "world.action.propose",
          source: "test-interaction-proxy",
          cycleId: event.cycleId,
          correlationId: event.correlationId,
          payload: {
            type: "MOVE_ENTITY",
            actorId: "stelle-001",
            payload: { entityId: "coffee-cup", newLocation: { sceneId: "stelle_room", parentId: "the-void" } }
          }
        });
      }
    });

    // 启动决策循环
    cogWin.startCycle("proactive", "test-illegal-flow", [{ id: "obs-001", type: "event", payload: { text: "I feel like experimenting." } }]);

    // 3. 验证结果
    const actionResult: any = await actionResultPromise;
    expect(actionResult.success).toBe(false);
    expect(actionResult.error).toContain("Invariant violated");

    const cycleResult: any = await cycleCompletedPromise;
    expect(cycleResult.cycle.status).toBe("completed"); // 即使动作失败，循环也会由于 memory 写入（记录失败）而完成
    
    // 检查持久化的 Trace
    const traceEntry = versionedStore.readLatest<any>({ namespace: "trace", partitionId: "stelle-001", objectId: cycleResult.cycle.cycleId });
    expect(traceEntry?.data.selectedIntentId).toBe("intent-illegal-move");
    
    console.log("Illegal action was successfully blocked by World Invariants!");
    console.log("Failure Reason:", actionResult.error);
    console.log("Narrative Fragment:", cycleResult.narrative.summary);
  });
});
