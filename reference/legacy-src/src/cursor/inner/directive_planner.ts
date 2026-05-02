import type { CursorDirectiveEnvelope, DirectivePlanningInput } from "./types.js";

// === Region: Constants ===

const FOCUS_STREAM_USES = new Set(["bridge_topic", "callback", "question"]);
const FOCUS_EXPIRY = 30 * 60 * 1000;
const WARNING_EXPIRY = 45 * 60 * 1000;

// === Region: Interfaces ===

export interface DirectivePlanner {
  plan(input: DirectivePlanningInput): CursorDirectiveEnvelope[];
}

// === Region: Default Implementation ===

export class DefaultDirectivePlanner implements DirectivePlanner {
  plan(input: DirectivePlanningInput): CursorDirectiveEnvelope[] {
    const now = input.now ?? Date.now();
    const directives: CursorDirectiveEnvelope[] = [];

    // 1. Determine Primary Focus
    const liveNote = input.fieldNotes.find((note) => note.safety === "safe" && FOCUS_STREAM_USES.has(note.streamUse));

    const activeTopic = input.activeTopics
      .filter((topic) => topic.status === "active")
      .sort((a, b) => b.priority - a.priority)[0];

    const focus = liveNote?.excerpt || activeTopic?.title || input.selfModel.currentFocus;

    if (focus) {
      directives.push({
        target: "live_danmaku",
        action: "apply_policy",
        policy: {
          replyBias: input.selfModel.styleBias.replyBias ?? "selective",
          vibeIntensity: input.selfModel.styleBias.vibeIntensity ?? 3,
          focusTopic: focus,
          instruction: `Focus on: ${focus}`,
        },
        priority: activeTopic ? Math.max(2, activeTopic.priority) : 2,
        expiresAt: now + FOCUS_EXPIRY,
      });
    }

    // 2. Apply Behavioral Warnings
    for (const warning of input.selfModel.behavioralWarnings.slice(0, 2)) {
      directives.push({
        target: "global",
        action: "apply_policy",
        policy: {
          replyBias: "selective",
          instruction: warning,
        },
        priority: 3,
        expiresAt: now + WARNING_EXPIRY,
      });
    }

    return directives;
  }
}
