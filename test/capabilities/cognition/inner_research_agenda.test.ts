import { describe, it, expect, vi } from "vitest";
import { DefaultResearchAgenda } from "../../../src/capabilities/cognition/reflection/research_agenda.js";
import type { CognitiveSignal, SelfModelSnapshot } from "../../../src/capabilities/cognition/reflection/types.js";

describe("DefaultResearchAgenda", () => {
  const mockSelf: SelfModelSnapshot = {
    mood: "calm",
    currentFocus: "test",
    activeConvictions: [],
    behavioralWarnings: [],
    styleBias: {},
  };

  it("high-salience signal creates an active topic", async () => {
    const agenda = new DefaultResearchAgenda();
    const signals: CognitiveSignal[] = [
      {
        id: "s1",
        source: "discord_text_channel",
        kind: "chat",
        summary: "User asking about AI selfhood",
        timestamp: Date.now(),
        impactScore: 5,
        salience: "high",
      },
    ];

    const update = await agenda.update(signals, mockSelf, Date.now());
    expect(update.addedTopics).toHaveLength(1);
    expect(agenda.activeTopics()).toHaveLength(1);
    expect(agenda.activeTopics()[0].title).toBe("User asking about AI selfhood");
  });

  it("three related medium signals merge into one topic", async () => {
    const agenda = new DefaultResearchAgenda({ mediumSignalThreshold: 3 });
    const now = Date.now();
    const signals: CognitiveSignal[] = [
      {
        id: "s1",
        source: "live_danmaku",
        kind: "stream",
        summary: "Lag report 1",
        timestamp: now,
        impactScore: 1,
        salience: "medium",
      },
      {
        id: "s2",
        source: "live_danmaku",
        kind: "stream",
        summary: "Lag report 2",
        timestamp: now + 1,
        impactScore: 1,
        salience: "medium",
      },
      {
        id: "s3",
        source: "live_danmaku",
        kind: "stream",
        summary: "Lag report 3",
        timestamp: now + 2,
        impactScore: 1,
        salience: "medium",
      },
    ];

    const update = await agenda.update(signals, mockSelf, now + 100);
    expect(update.addedTopics).toHaveLength(1);
    expect(agenda.activeTopics()).toHaveLength(1);
    expect(agenda.activeTopics()[0].evidence).toHaveLength(3);
  });

  it("expired topics close and are excluded from activeTopics", async () => {
    const ttl = 1000;
    const agenda = new DefaultResearchAgenda({ topicTtlMs: ttl });
    const now = Date.now();

    await agenda.update(
      [
        {
          id: "s1",
          source: "system",
          kind: "theme",
          summary: "Temporary topic",
          timestamp: now,
          impactScore: 1,
          salience: "high",
        },
      ],
      mockSelf,
      now,
    );

    expect(agenda.activeTopics()).toHaveLength(1);

    const update = await agenda.update([], mockSelf, now + ttl + 1);
    expect(update.closedTopics).toHaveLength(1);
    expect(agenda.activeTopics()).toHaveLength(0);
  });

  it("topic id is deterministic based on key and time", async () => {
    const agenda = new DefaultResearchAgenda();
    const now = 123456789;
    const signals: CognitiveSignal[] = [
      {
        id: "s1",
        source: "discord_text_channel",
        kind: "chat",
        summary: "User asking about AI selfhood",
        timestamp: now,
        impactScore: 5,
        salience: "high",
      },
    ];

    const update = await agenda.update(signals, mockSelf, now);
    const topicId = update.addedTopics[0].id;
    // Expected: topic-chat-discord_text_channel-user_asking-123456789
    expect(topicId).toContain("chat-discord_text_channel-user_asking");
    expect(topicId).toContain("123456789");
    expect(topicId).not.toContain("topic-123456789-"); // random suffix removed
  });

  it("explicit signal evidence is preserved in topic evidence", async () => {
    const agenda = new DefaultResearchAgenda();
    const now = Date.now();
    const signals: CognitiveSignal[] = [
      {
        id: "s1",
        source: "system",
        kind: "theme",
        summary: "Complex event",
        timestamp: now,
        impactScore: 5,
        salience: "high",
        evidence: [
          { source: "sub-process", excerpt: "Detailed logs Part 1", timestamp: now - 100 },
          { source: "sub-process", excerpt: "Detailed logs Part 2", timestamp: now - 50 },
        ],
      },
    ];

    const update = await agenda.update(signals, mockSelf, now);
    const topic = update.addedTopics[0];
    expect(topic.evidence).toHaveLength(2);
    expect(topic.evidence[0].excerpt).toBe("Detailed logs Part 1");
    expect(topic.evidence[1].excerpt).toBe("Detailed logs Part 2");
  });

  it("hydrate restores topics from memory", () => {
    const agenda = new DefaultResearchAgenda();
    const mockTopics = [{ id: "t1", title: "Saved Topic", status: "active", evidence: [] }] as any;

    agenda.hydrate(mockTopics);
    expect(agenda.activeTopics()).toHaveLength(1);
    expect(agenda.activeTopics()[0].id).toBe("t1");
  });
});
