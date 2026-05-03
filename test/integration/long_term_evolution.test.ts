import { describe, it, expect, vi } from "vitest";
import { StelleEventBus } from "../../src/core/event/event_bus.js";
import { InternalCognitionWindow } from "../../src/windows/internal_cognition/runtime.js";
import { InternalInteractionWindow } from "../../src/windows/internal_interaction/runtime.js";
import { InternalMemoryWindow } from "../../src/windows/internal_memory/runtime.js";
import { CognitionCapability } from "../../src/capabilities/cognition/api.js";
import { InteractionPolicyCapability } from "../../src/capabilities/interaction_policy/api.js";
import { DecisionPolicyCapability } from "../../src/capabilities/decision_policy/api.js";
import { SelfMemoryCapability } from "../../src/capabilities/self_memory/api.js";
import { ReflectionCapability } from "../../src/capabilities/reflection/api.js";
import { NarrativeCapability } from "../../src/capabilities/narrative/api.js";
import { VersionedStore } from "../../src/core/state/versioned_store.js";

describe("Long-term Evolution & Personality Learning", () => {
  it("should trigger reflection after multiple cycles and use the insight in subsequent decisions", async () => {
    const eventBus = new StelleEventBus();
    const cognition = new CognitionCapability();
    const interactionPolicy = new InteractionPolicyCapability();
    const decisionPolicy = new DecisionPolicyCapability();
    const selfMemory = new SelfMemoryCapability();
    const narrative = new NarrativeCapability();
    const versionedStore = new VersionedStore();
    
    // 配置反思策略：只需要 2 条记忆就触发，取消冷却
    const reflection = new ReflectionCapability();
    (reflection as any).scheduler.policy = {
      minNewMemories: 2,
      minImportanceSum: 0,
      cooldownMs: 0,
      maxReflectionsPerHour: 100,
      requireEvidenceCount: 1,
    };

    const cogWin = new InternalCognitionWindow({
      eventBus, cognition, decisionPolicy, narrative, versionedStore, agentId: "stelle"
    });
    new InternalInteractionWindow({ eventBus, interactionPolicy });
    new InternalMemoryWindow({ eventBus, selfMemory, reflection });

    // 1. 运行第一个循环
    let cycleCompleted = new Promise(resolve => eventBus.subscribe("cycle.completed", resolve));
    cogWin.startCycle("reply", "corr-1", [{ id: "msg-1", type: "text", payload: { text: "I love coffee!" } }]);
    await cycleCompleted;

    // 2. 运行第二个循环 -> 触发反思
    let reflectionGenerated = new Promise(resolve => eventBus.subscribe("reflection.generated", resolve));
    cycleCompleted = new Promise(resolve => eventBus.subscribe("cycle.completed", resolve));
    cogWin.startCycle("reply", "corr-2", [{ id: "msg-2", type: "text", payload: { text: "Coffee is great for focus." } }]);
    
    await reflectionGenerated;
    await cycleCompleted;
    
    // 给一点时间让 memory.write 事件循环跑完
    await new Promise(r => setTimeout(resolve => r(0), 10));

    // 验证反思是否已存入记忆
    const memories = await selfMemory.retrieve({ agentId: "stelle", query: "reflection" });
    expect(memories.some(m => m.kind === "reflection")).toBe(true);
    console.log("Reflection successfully triggered and persisted!");

    // 3. 运行第三个循环 -> 检索到反思并影响决策
    // 我们拦截 build_context 观察它是否带入了反思
    const buildContextSpy = vi.spyOn(cognition, 'build_context');
    
    cycleCompleted = new Promise(resolve => eventBus.subscribe("cycle.completed", resolve));
    cogWin.startCycle("reply", "corr-3", [{ id: "msg-3", type: "text", payload: { text: "What did we learn from our past?" } }]);
    await cycleCompleted;

    const lastContextCall = buildContextSpy.mock.calls[buildContextSpy.mock.calls.length - 1][0];
    expect(lastContextCall.memoryHits.some((m: any) => m.kind === "reflection")).toBe(true);
    
    console.log("Decision cycle successfully retrieved past reflection!");
    console.log("Memory Hits in Context:", lastContextCall.memoryHits.map((m: any) => `${m.kind}: ${m.summary}`));
  });
});
