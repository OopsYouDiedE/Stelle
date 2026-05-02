import type { PerceptualEvent } from "../../../core/protocol/perceptual_event.js";
import type { AttentionResult } from "./pipeline.js";
import { eventText, isHighPriority } from "./event_features.js";

/**
 * DefaultRuleAttentionPolicy is a small demo/rule policy, not the production cognition layer.
 */
export class DefaultRuleAttentionPolicy {
  async evaluate(event: PerceptualEvent): Promise<AttentionResult> {
    const text = eventText(event);
    if (Array.isArray((event.payload as { messages?: unknown[] })?.messages)) {
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
}
