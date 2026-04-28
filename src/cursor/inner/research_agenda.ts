import type { CognitiveSignal, ResearchTopic, ResearchAgendaUpdate, SelfModelSnapshot, ResearchEvidence } from "./types.js";
import { truncateText } from "../../utils/text.js";

export interface ResearchAgenda {
  update(signals: CognitiveSignal[], self: SelfModelSnapshot, now?: number): Promise<ResearchAgendaUpdate>;
  activeTopics(): ResearchTopic[];
  snapshot(): Record<string, unknown>;
  hydrate(topics: ResearchTopic[]): void;
}

export interface ResearchAgendaOptions {
  topicTtlMs?: number;
  maxTopics?: number;
  mediumSignalThreshold?: number;
}

export class DefaultResearchAgenda implements ResearchAgenda {
  private topics: ResearchTopic[] = [];
  private readonly topicTtlMs: number;
  private readonly maxTopics: number;
  private readonly mediumSignalThreshold: number;

  constructor(options: ResearchAgendaOptions = {}) {
    this.topicTtlMs = options.topicTtlMs ?? 6 * 60 * 60 * 1000; // 6 hours
    this.maxTopics = options.maxTopics ?? 10;
    this.mediumSignalThreshold = options.mediumSignalThreshold ?? 3;
  }

  hydrate(topics: ResearchTopic[]): void {
    if (!Array.isArray(topics)) return;
    // Basic validation to avoid corrupt memory
    this.topics = topics.filter(t => 
      t && typeof t.id === "string" && 
      t.status === "active" && 
      Array.isArray(t.evidence)
    );
  }

  async update(signals: CognitiveSignal[], _self: SelfModelSnapshot, now = Date.now()): Promise<ResearchAgendaUpdate> {
    const addedTopics: ResearchTopic[] = [];
    const updatedTopics: ResearchTopic[] = [];
    const closedTopics: ResearchTopic[] = [];

    // 1. Close stale topics
    for (const topic of this.topics) {
      if (topic.status === "active" && topic.expiresAt && now > topic.expiresAt) {
        topic.status = "closed";
        closedTopics.push(topic);
      }
    }

    // 2. Group signals by normalized key
    const signalsByKey = new Map<string, CognitiveSignal[]>();
    for (const signal of signals) {
      const key = this.getNormalizedKey(signal);
      if (!signalsByKey.has(key)) {
        signalsByKey.set(key, []);
      }
      signalsByKey.get(key)!.push(signal);
    }

    // 3. Process signal groups
    for (const [key, group] of signalsByKey) {
      const highSalience = group.filter(s => s.salience === "high");
      const mediumSalience = group.filter(s => s.salience === "medium");

      if (highSalience.length > 0 || mediumSalience.length >= this.mediumSignalThreshold) {
        const primarySignal = highSalience[0] || mediumSalience[0];
        const existingTopic = this.topics.find(t => t.status === "active" && this.isTopicRelated(t, primarySignal));

        if (existingTopic) {
          this.updateTopic(existingTopic, group, now);
          if (!updatedTopics.includes(existingTopic)) {
            updatedTopics.push(existingTopic);
          }
        } else if (this.activeTopics().length < this.maxTopics) {
          const newTopic = this.createTopic(primarySignal, group, now, key);
          this.topics.push(newTopic);
          addedTopics.push(newTopic);
        }
      }
    }

    return { addedTopics, updatedTopics, closedTopics };
  }

  activeTopics(): ResearchTopic[] {
    return this.topics.filter(t => t.status === "active");
  }

  snapshot(): Record<string, unknown> {
    const active = this.activeTopics();
    return {
      activeResearchTopicsCount: active.length,
      activeResearchTopics: active.map(t => ({
        id: t.id,
        title: truncateText(t.title, 60),
        priority: t.priority
      }))
    };
  }

  private getNormalizedKey(signal: CognitiveSignal): string {
    // Stable normalized key derived from kind/source/summary
    const kind = (signal.kind || "unknown").toLowerCase().trim();
    const source = (signal.source || "unknown").toLowerCase().trim();
    // Use first 2 words of summary for broad grouping
    const summary = (signal.summary || "none").toLowerCase()
      .replace(/[^\w\s]/g, "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join("_");
    return `${kind}:${source}:${summary}`;
  }

  private isTopicRelated(topic: ResearchTopic, signal: CognitiveSignal): boolean {
    // Simple heuristic: title overlap or same normalized key components
    const key = this.getNormalizedKey(signal);
    const [kind] = key.split(":");
    
    if (topic.subjectKind === this.mapKindToSubject(kind)) {
      const signalWords = signal.summary.toLowerCase().split(/\s+/);
      const titleWords = topic.title.toLowerCase().split(/\s+/);
      const overlap = signalWords.filter(w => w.length > 2 && titleWords.includes(w));
      return overlap.length >= 1;
    }
    return false;
  }

  private mapKindToSubject(kind: string): ResearchTopic["subjectKind"] {
    const k = (kind || "").toLowerCase();
    if (k.includes("person") || k.includes("user")) return "person";
    if (k.includes("community") || k.includes("chat")) return "community";
    if (k.includes("self") || k.includes("ego")) return "self";
    if (k.includes("stream") || k.includes("live")) return "stream";
    if (k.includes("theme") || k.includes("topic")) return "theme";
    return "relationship";
  }

  private createTopic(primary: CognitiveSignal, group: CognitiveSignal[], now: number, key: string): ResearchTopic {
    const subjectKind = this.mapKindToSubject(primary.kind);
    // Deterministic ID: kind-source-summary-createdAt
    const safeKey = key.replace(/[:\s]/g, "-");
    return {
      id: `topic-${safeKey}-${now}`,
      title: truncateText(primary.summary, 100),
      subjectKind,
      status: "active",
      priority: primary.salience === "high" ? 3 : 1,
      confidence: 0.5,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + this.topicTtlMs,
      evidence: group.flatMap(s => this.signalToEvidence(s)),
      openQuestions: [`Why is ${primary.summary} occurring?`],
      provisionalFindings: [],
      nextActions: [{ type: "observe", description: "Collect more evidence", status: "pending" }]
    };
  }

  private updateTopic(topic: ResearchTopic, group: CognitiveSignal[], now: number): void {
    topic.updatedAt = now;
    topic.expiresAt = now + this.topicTtlMs;
    
    for (const s of group) {
      const evidences = this.signalToEvidence(s);
      for (const e of evidences) {
        if (!topic.evidence.some(existing => existing.timestamp === e.timestamp && existing.excerpt === e.excerpt)) {
          topic.evidence.push(e);
        }
      }
      if (s.salience === "high") {
        topic.priority = Math.min(5, topic.priority + 1);
      }
    }
    
    topic.confidence = Math.min(1.0, topic.confidence + (group.length * 0.05));
    if (topic.evidence.length > 20) {
      topic.evidence = topic.evidence.slice(-20);
    }
  }

  private signalToEvidence(signal: CognitiveSignal): ResearchEvidence[] {
    if (signal.evidence && signal.evidence.length > 0) {
      return signal.evidence.map(e => ({
        source: e.source || signal.source,
        excerpt: e.excerpt,
        timestamp: e.timestamp ?? signal.timestamp
      }));
    }
    return [{
      source: signal.source,
      excerpt: signal.summary,
      timestamp: signal.timestamp
    }];
  }
}
