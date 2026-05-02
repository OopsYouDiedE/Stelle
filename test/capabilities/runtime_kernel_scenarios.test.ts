import { describe, expect, it, vi } from "vitest";
import { RuntimeKernel } from "../../src/capabilities/cognition/runtime_kernel/kernel.js";
import type { PerceptualEvent } from "../../src/core/protocol/perceptual_event.js";
import type {
  RuntimeKernelPipeline,
  AttentionResult,
} from "../../src/capabilities/cognition/runtime_kernel/pipeline.js";
import { ComponentLoader } from "../../src/core/runtime/component_loader.js";
import { ComponentRegistry } from "../../src/core/runtime/component_registry.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";
import { runtimeKernelCapability } from "../../src/capabilities/cognition/runtime_kernel/package.js";

describe("RuntimeKernel Scenarios", () => {
  it("should accept an event and plan intents", async () => {
    const mockPipeline: RuntimeKernelPipeline = {
      enrich: async (e) => e,
      evaluateAttention: async () => ({ accepted: true, reason: "interesting", salience: 1.0 }),
      plan: async (e) => [
        {
          id: "intent_1",
          type: "respond",
          sourcePackageId: "capability.cognition.runtime_kernel",
          priority: 1,
          createdAt: Date.now(),
          reason: "test reply",
          payload: { text: "Hello!" },
        },
      ],
    };

    const kernel = new RuntimeKernel(mockPipeline);
    const event: PerceptualEvent = {
      id: "evt_1",
      type: "live.text_message",
      sourceWindow: "window.live",
      timestamp: Date.now(),
      payload: { text: "Hi" },
    };

    const decisions = await kernel.step(event);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].kind).toBe("intent");
    if (decisions[0].kind === "intent") {
      expect(decisions[0].intent.payload.text).toBe("Hello!");
    }
  });

  it("should ignore low-salience events", async () => {
    const mockPipeline: RuntimeKernelPipeline = {
      enrich: async (e) => e,
      evaluateAttention: async () => ({ accepted: false, reason: "noise", salience: 0.1 }),
      plan: async () => [],
    };

    const kernel = new RuntimeKernel(mockPipeline);
    const event: PerceptualEvent = {
      id: "evt_2",
      type: "live.text_message",
      sourceWindow: "window.live",
      timestamp: Date.now(),
      payload: { text: "..." },
    };

    const decisions = await kernel.step(event);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].kind).toBe("ignored");
    expect(decisions[0].reason).toBe("noise");
  });

  it("covers the default live kernel scenarios with reasoned decisions", async () => {
    const registry = new ComponentRegistry();
    const loader = new ComponentLoader({ registry, events: new StelleEventBus() });
    await loader.load(runtimeKernelCapability);
    await loader.start(runtimeKernelCapability.id);
    const kernel = registry.resolve<RuntimeKernel>("cognition.kernel")!;

    const question = await kernel.step(event("q1", "主播在吗？"));
    expect(question[0]).toMatchObject({ kind: "intent" });
    expect(question[0].reason).toContain("Connection test");

    const spam = await kernel.step(event("spam1", "广告 spam"));
    expect(spam[0]).toMatchObject({ kind: "ignored", reason: "low-value spam ignored" });

    const batch = await kernel.step({
      ...event("batch1", ""),
      type: "live.text_batch",
      payload: { messages: [{ text: "A?" }, { text: "B?" }] },
    });
    expect(batch[0]).toMatchObject({ kind: "intent" });
    if (batch[0].kind === "intent") expect(batch[0].intent.payload).toMatchObject({ merge: true });

    const gift = await kernel.step({
      ...event("gift1", "支持一下"),
      payload: { text: "支持一下", kind: "super_chat", trust: { paid: true } },
    });
    if (gift[0].kind === "intent") expect(gift[0].intent.priority).toBe(10);

    await kernel.onExecutionResult({
      commandId: "stage",
      status: "queued",
      timestamp: Date.now(),
      metadata: { stageBusy: true },
    });
    const delayed = await kernel.step(event("busy1", "这个问题可以回答吗？"));
    if (delayed[0].kind === "intent") expect(delayed[0].intent.metadata).toMatchObject({ delayed: true });

    const idle = await kernel.tick();
    expect(idle[0]).toMatchObject({ kind: "intent" });
    expect(idle[0].reason).toContain("Idle tick");

    const failingKernel = new RuntimeKernel({
      enrich: async (e) => e,
      evaluateAttention: async () => ({ accepted: true, reason: "ok", salience: 1 }),
      plan: async () => {
        throw new Error("LLM unavailable");
      },
    });
    const fallback = await failingKernel.step(event("fail1", "说点什么？"));
    expect(fallback[0]).toMatchObject({ kind: "intent" });
    if (fallback[0].kind === "intent") expect(fallback[0].intent.payload).toMatchObject({ fallback: true });
  });
});

function event(id: string, text: string): PerceptualEvent<{ text: string }> {
  return {
    id,
    type: "live.text_message",
    sourceWindow: "window.live",
    actorId: "viewer",
    timestamp: Date.now(),
    payload: { text },
  };
}
