import type { Intent } from "../../../core/protocol/intent.js";
import type { PerceptualEvent } from "../../../core/protocol/perceptual_event.js";
import { eventText, isHighPriority } from "./event_features.js";

/**
 * DemoKernelPlanner is intentionally simple. Keep production cognition in a replaceable pipeline.
 */
export class DemoKernelPlanner {
  async plan(event: PerceptualEvent): Promise<Intent[]> {
    const text = eventText(event);
    const now = Date.now();
    const priority = isHighPriority(event) ? 10 : 1;
    if (Array.isArray((event.payload as { messages?: unknown[] })?.messages)) {
      return [
        {
          id: `intent_batch_${now}`,
          type: "respond",
          sourcePackageId: "capability.cognition.runtime_kernel",
          priority: 2,
          createdAt: now,
          reason: "Merged multiple messages into one response intent",
          sourceEventIds: [event.id],
          payload: { text: "我看到这一波问题了，先合起来回应一下。", merge: true, sourceWindow: event.sourceWindow },
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

function respondIntent(event: PerceptualEvent, text: string, reason: string, priority: number): Intent {
  return {
    id: `intent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "respond",
    sourcePackageId: "capability.cognition.runtime_kernel",
    priority,
    createdAt: Date.now(),
    reason,
    sourceEventIds: [event.id],
    payload: {
      text,
      sourceWindow: event.sourceWindow,
      channelId: (event.payload as { channelId?: unknown })?.channelId,
      replyToMessageId: (event.payload as { replyToMessageId?: unknown })?.replyToMessageId,
    },
  };
}
