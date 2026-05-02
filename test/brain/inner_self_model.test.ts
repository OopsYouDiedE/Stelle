import { describe, expect, it } from "vitest";
import { DefaultSelfModel } from "../../src/capabilities/cognition/reflection/self_model.js";
import type { CognitiveSignal, ResearchTopic } from "../../src/capabilities/cognition/reflection/types.js";

describe("DefaultSelfModel", () => {
  const topic = (title: string, confidence = 0.6): ResearchTopic => ({
    id: `topic-${title}`,
    title,
    subjectKind: "theme",
    status: "active",
    priority: 2,
    confidence,
    createdAt: 1,
    updatedAt: 1,
    evidence: [],
    openQuestions: [],
    provisionalFindings: ["Treat this as an active theme."],
    nextActions: [],
  });

  it("updates focus and convictions from research updates", async () => {
    const model = new DefaultSelfModel();
    const update = await model.update({
      signals: [],
      researchUpdates: {
        addedTopics: [topic("AI selfhood")],
        updatedTopics: [topic("AI selfhood", 0.7)],
        closedTopics: [],
      },
    });

    expect(update.snapshot.currentFocus).toBe("AI selfhood");
    expect(update.snapshot.activeConvictions[0]).toMatchObject({
      topic: "AI selfhood",
      confidence: 0.7,
    });
    expect(update.changes.length).toBeGreaterThan(0);
  });

  it("adds warnings and alert mood for sensitive high-salience signals", async () => {
    const model = new DefaultSelfModel();
    const signal: CognitiveSignal = {
      id: "sensitive-1",
      source: "system",
      kind: "theme",
      summary: "Sensitive boundary issue",
      timestamp: 1,
      impactScore: 9,
      salience: "high",
    };

    const update = await model.update({
      signals: [signal],
      researchUpdates: { addedTopics: [], updatedTopics: [], closedTopics: [] },
    });

    expect(update.snapshot.mood).toBe("alert");
    expect(update.snapshot.behavioralWarnings[0]).toContain("Sensitive boundary issue");
  });

  it("caps convictions, clamps confidence, and degrades invalid hydrate data", () => {
    const model = new DefaultSelfModel(undefined, 2);
    model.hydrate({
      mood: "",
      currentFocus: undefined,
      activeConvictions: [
        { topic: "A", stance: "A stance", confidence: 5 },
        { topic: "B", stance: "B stance", confidence: -1 },
        { topic: "C", stance: "C stance", confidence: 0.5 },
      ],
      behavioralWarnings: ["ok", ""],
      styleBias: {},
    });

    const snapshot = model.snapshot();
    expect(snapshot.mood).toBe("calm");
    expect(snapshot.currentFocus).toBe("");
    expect(snapshot.activeConvictions).toHaveLength(2);
    expect(snapshot.activeConvictions.every((c) => c.confidence >= 0 && c.confidence <= 1)).toBe(true);
    expect(snapshot.behavioralWarnings).toEqual(["ok"]);
  });
});
