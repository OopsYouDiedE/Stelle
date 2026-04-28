import type { FieldSamplingInput, FieldSamplingResult, FieldNote } from "./types.js";

export interface FieldSampler {
  sample(input: FieldSamplingInput): Promise<FieldSamplingResult>;
}

export class DefaultFieldSampler implements FieldSampler {
  private readonly maxNotes: number;
  private readonly now: () => number;

  constructor(options: { maxNotes?: number; now?: () => number } = {}) {
    this.maxNotes = options.maxNotes ?? 10;
    this.now = options.now ?? Date.now;
  }

  async sample(input: FieldSamplingInput): Promise<FieldSamplingResult> {
    const { activeTopics, recentSignals } = input;
    const notes: FieldNote[] = [];
    const now = this.now();

    // 1. Generate notes from active topics (research-driven field notes)
    for (const topic of activeTopics) {
      if (notes.length >= this.maxNotes) break;

      const isSensitive = topic.priority > 4 || topic.title.toLowerCase().includes("sensitive") || topic.title.toLowerCase().includes("private");
      
      notes.push({
        id: `note-topic-${topic.id}-${now}`,
        topicId: topic.id,
        source: "memory",
        excerpt: `Research Topic: ${topic.title} (${topic.subjectKind})`,
        streamUse: isSensitive ? "avoid" : "bridge_topic",
        vibe: topic.priority > 3 ? "curious" : "quiet",
        safety: isSensitive ? "sensitive" : "safe",
        createdAt: now,
      });
    }

    // 2. Generate notes from recent signals (live/discord interaction field notes)
    for (const signal of recentSignals) {
      if (notes.length >= this.maxNotes) break;

      const summary = typeof signal.summary === "string" ? signal.summary : "";
      const source = signal.source === "live_danmaku" ? "live" : (signal.source === "discord_text_channel" ? "discord" : "system");
      const isHighImpact = signal.impactScore > 5 || signal.salience === "high";
      const normalizedSummary = summary.toLowerCase();
      const isSensitive = normalizedSummary.includes("bad") || normalizedSummary.includes("toxic") || normalizedSummary.includes("sensitive");

      notes.push({
        id: `note-signal-${signal.id}-${now}`,
        source,
        excerpt: summary,
        streamUse: isSensitive ? "avoid" : (isHighImpact ? "callback" : "question"),
        vibe: isHighImpact ? "emotional" : "curious",
        safety: isSensitive ? "avoid" : "safe",
        createdAt: now,
      });
    }

    // 3. Recommended Focus logic (deterministic)
    let recommendedFocus: string | undefined;
    const safeBridgeNotes = notes.filter(n => n.safety === "safe" && n.streamUse === "bridge_topic");
    const safeCallbackNotes = notes.filter(n => n.safety === "safe" && n.streamUse === "callback");

    if (safeCallbackNotes.length > 0) {
      recommendedFocus = `Callback: ${safeCallbackNotes[0].excerpt}`;
    } else if (safeBridgeNotes.length > 0) {
      recommendedFocus = `Explore Topic: ${safeBridgeNotes[0].excerpt}`;
    }

    return {
      notes: notes.slice(0, this.maxNotes),
      recommendedFocus,
    };
  }
}
