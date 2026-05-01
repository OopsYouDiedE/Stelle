import { describe, it, expect } from "vitest";
import { DefaultFieldSampler } from "../../src/cursor/inner/field_sampler.js";
import type { ResearchTopic, CognitiveSignal, SelfModelSnapshot } from "../../src/cursor/inner/types.js";

describe("DefaultFieldSampler", () => {
  const sampler = new DefaultFieldSampler({ maxNotes: 5 });

  const mockSelfModel: SelfModelSnapshot = {
    mood: "calm",
    currentFocus: "Test focus",
    activeConvictions: [],
    behavioralWarnings: [],
    styleBias: {},
  };

  it("creates a safe bridge note from an active topic", async () => {
    const activeTopics: ResearchTopic[] = [
      {
        id: "topic-1",
        title: "Learning TypeScript",
        subjectKind: "theme",
        status: "active",
        priority: 3,
        confidence: 0.8,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        evidence: [],
        openQuestions: [],
        provisionalFindings: [],
        nextActions: [],
      },
    ];

    const result = await sampler.sample({
      activeTopics,
      recentSignals: [],
      selfModel: mockSelfModel,
    });

    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].streamUse).toBe("bridge_topic");
    expect(result.notes[0].safety).toBe("safe");
    expect(result.recommendedFocus).toContain("Learning TypeScript");
  });

  it("creates a callback note from a high-impact live signal", async () => {
    const recentSignals: CognitiveSignal[] = [
      {
        id: "sig-1",
        source: "live_danmaku",
        kind: "chat",
        summary: "User says hello world",
        timestamp: Date.now(),
        impactScore: 7,
        salience: "high",
      },
    ];

    const result = await sampler.sample({
      activeTopics: [],
      recentSignals,
      selfModel: mockSelfModel,
    });

    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].streamUse).toBe("callback");
    expect(result.notes[0].vibe).toBe("emotional");
    expect(result.recommendedFocus).toBe("Callback: User says hello world");
  });

  it("handles sensitive topics and signals as avoid", async () => {
    const activeTopics: ResearchTopic[] = [
      {
        id: "topic-private",
        title: "Sensitive Private Data",
        subjectKind: "self",
        status: "active",
        priority: 5,
        confidence: 0.9,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        evidence: [],
        openQuestions: [],
        provisionalFindings: [],
        nextActions: [],
      },
    ];

    const recentSignals: CognitiveSignal[] = [
      {
        id: "sig-toxic",
        source: "live_danmaku",
        kind: "chat",
        summary: "Toxic comment",
        timestamp: Date.now(),
        impactScore: 3,
        salience: "low",
      },
    ];

    const result = await sampler.sample({
      activeTopics,
      recentSignals,
      selfModel: mockSelfModel,
    });

    expect(result.notes).toHaveLength(2);
    expect(result.notes.every((n) => n.streamUse === "avoid")).toBe(true);
    expect(result.notes.some((n) => n.safety === "avoid")).toBe(true);
    expect(result.notes.some((n) => n.safety === "sensitive")).toBe(true);
    expect(result.recommendedFocus).toBeUndefined();
  });

  it("bounds notes by maxNotes", async () => {
    const activeTopics: ResearchTopic[] = Array.from({ length: 10 }, (_, i) => ({
      id: `topic-${i}`,
      title: `Topic ${i}`,
      subjectKind: "theme",
      status: "active",
      priority: 1,
      confidence: 0.5,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      evidence: [],
      openQuestions: [],
      provisionalFindings: [],
      nextActions: [],
    }));

    const result = await sampler.sample({
      activeTopics,
      recentSignals: [],
      selfModel: mockSelfModel,
    });

    expect(result.notes).toHaveLength(5);
  });
});
