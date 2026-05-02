import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
} from "../../../core/protocol/component.js";
import { RuntimeKernel } from "./kernel.js";
import type { RuntimeKernelPipeline, AttentionResult } from "./pipeline.js";
import type { PerceptualEvent } from "../../../core/protocol/perceptual_event.js";
import type { Intent } from "../../../core/protocol/intent.js";

import { createRuntimeKernelDebugProvider } from "./debug_provider.js";

let activeKernel: RuntimeKernel | undefined;

class DefaultRuntimeKernelPipeline implements RuntimeKernelPipeline {
  async enrich(event: PerceptualEvent): Promise<PerceptualEvent> {
    return event;
  }
  async evaluateAttention(event: PerceptualEvent): Promise<AttentionResult> {
    const text = eventText(event);
    if (event.type === "live.text_batch" || Array.isArray((event.payload as { messages?: unknown[] })?.messages)) {
      return { accepted: true, reason: "message batch accepted for merge planning", salience: 0.7 };
    }
    if (event.salienceHint !== undefined && event.salienceHint < 0.15) {
      return { accepted: false, reason: "salience hint below attention threshold", salience: event.salienceHint };
    }
    if (!text && event.type !== "scene.observation.received") {
      return { accepted: false, reason: "event has no actionable text or observation", salience: 0 };
    }
    if (/\b(spam|广告|刷屏)\b/i.test(text)) {
      return { accepted: false, reason: "low-value spam ignored", salience: 0.05 };
    }
    if (isHighPriority(event)) {
      return { accepted: true, reason: "high priority proposal accepted", salience: 1 };
    }
    if (/(\?|？|吗|么|在吗|能看到吗|hello|hi|你好)/i.test(text)) {
      return { accepted: true, reason: "addressable message accepted", salience: 0.8 };
    }
    if (event.type === "scene.observation.received") {
      return { accepted: true, reason: "structured scene observation accepted", salience: 0.6 };
    }
    return { accepted: false, reason: "ordinary chatter below response threshold", salience: 0.2 };
  }
  async plan(event: PerceptualEvent): Promise<Intent[]> {
    const text = eventText(event);
    const now = Date.now();
    const priority = isHighPriority(event) ? 10 : 1;
    if (event.type === "live.text_batch" || Array.isArray((event.payload as { messages?: unknown[] })?.messages)) {
      return [
        {
          id: `intent_batch_${now}`,
          type: "respond",
          sourcePackageId: "capability.cognition.runtime_kernel",
          priority: 2,
          createdAt: now,
          reason: "Merged multiple live messages into one response intent",
          sourceEventIds: [event.id],
          payload: { text: "我看到这一波问题了，先合起来回应一下。", merge: true },
        },
      ];
    }
    if (/在吗|能看到吗/i.test(text)) {
      return [
        respondIntent(event, "在的，能看到。", "Connection test message receives an explicit response", priority),
      ];
    }
    if (event.type === "scene.observation.received") {
      return [
        {
          id: `intent_observe_${now}`,
          type: "observe",
          sourcePackageId: "capability.cognition.runtime_kernel",
          priority,
          createdAt: now,
          reason: "Scene observation summarized for runtime cognition",
          sourceEventIds: [event.id],
          payload: event.payload,
        },
      ];
    }
    return [
      respondIntent(event, `收到：${text || "我看到了"}`, "Addressable event planned as response intent", priority),
    ];
  }

  async planTick(): Promise<Intent[]> {
    return [
      {
        id: `intent_idle_${Date.now()}`,
        type: "respond",
        sourcePackageId: "capability.cognition.runtime_kernel",
        priority: 0,
        createdAt: Date.now(),
        reason: "Idle tick generated a proactive topic intent",
        payload: { text: "趁现在空一点，我抛个小话题。", proactive: true },
      },
    ];
  }
}

export const runtimeKernelCapability: ComponentPackage = {
  id: "capability.cognition.runtime_kernel",
  kind: "capability",
  version: "1.0.0",
  displayName: "Runtime Kernel",

  provides: [
    { id: "cognition.kernel", kind: "service" },
    { id: "cognition.kernel.debug", kind: "debug_provider" },
  ],

  register(ctx: ComponentRegisterContext) {
    const pipeline = new DefaultRuntimeKernelPipeline();
    const kernel = new RuntimeKernel(pipeline);
    activeKernel = kernel;
    ctx.registry.provideForPackage?.(runtimeKernelCapability.id, "cognition.kernel", kernel) ??
      ctx.registry.provide("cognition.kernel", kernel);
    ctx.registry.provideDebugProvider(createRuntimeKernelDebugProvider(kernel));
  },

  async start(ctx: ComponentRuntimeContext) {
    ctx.logger.log("Runtime Kernel started");
  },

  async stop(ctx: ComponentRuntimeContext) {
    ctx.logger.log("Runtime Kernel stopped");
  },

  async snapshotState() {
    return activeKernel?.snapshot();
  },

  async hydrateState(state: unknown) {
    if (activeKernel && state && typeof state === "object") {
      activeKernel.hydrate(state as ReturnType<RuntimeKernel["snapshot"]>);
    }
  },
};

function eventText(event: PerceptualEvent): string {
  const payload = event.payload as { text?: unknown; summary?: unknown; message?: { content?: unknown } };
  return String(payload?.text ?? payload?.summary ?? payload?.message?.content ?? "").trim();
}

function isHighPriority(event: PerceptualEvent): boolean {
  const payload = event.payload as Record<string, unknown>;
  const trust = payload?.trust as Record<string, unknown> | undefined;
  return Boolean(
    event.metadata?.priority === "high" ||
    payload?.priority === "high" ||
    payload?.kind === "gift" ||
    payload?.kind === "super_chat" ||
    trust?.paid === true,
  );
}

function respondIntent(event: PerceptualEvent, text: string, reason: string, priority: number): Intent {
  return {
    id: `intent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "respond",
    sourcePackageId: "capability.cognition.runtime_kernel",
    priority,
    createdAt: Date.now(),
    reason,
    sourceEventIds: [event.id],
    payload: { text },
  };
}
