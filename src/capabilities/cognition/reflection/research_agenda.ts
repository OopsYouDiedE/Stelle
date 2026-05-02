import type {
  CognitiveSignal,
  ResearchTopic,
  ResearchAgendaUpdate,
  SelfModelSnapshot,
  ResearchEvidence,
} from "./types.js";
import { truncateText } from "../../../shared/text.js";
import { SemanticClusterService } from "../../memory/store/semantic.js";

// === Region: Constants ===

const DEFAULT_TOPIC_TTL = 6 * 60 * 60 * 1000; // 6 hours
const DEFAULT_MAX_TOPICS = 10;
const DEFAULT_MEDIUM_SIGNAL_THRESHOLD = 3;
const NON_ALPHANUMERIC_REGEX = /[^\w\s]/g;
const WHITESPACE_REGEX = /\s+/;

// === Region: Interfaces ===

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

// === Region: Default Implementation ===

export class DefaultResearchAgenda implements ResearchAgenda {
  private topics: ResearchTopic[] = [];
  private readonly topicTtlMs: number;
  private readonly maxTopics: number;
  private readonly mediumSignalThreshold: number;
  private readonly semanticService?: SemanticClusterService;

  constructor(
    semanticServiceOrOptions: SemanticClusterService | ResearchAgendaOptions = {},
    options: ResearchAgendaOptions = {},
  ) {
    const hasSemanticService =
      typeof (semanticServiceOrOptions as SemanticClusterService).extractFeatures === "function";
    const resolvedOptions = hasSemanticService ? options : (semanticServiceOrOptions as ResearchAgendaOptions);
    this.semanticService = hasSemanticService ? (semanticServiceOrOptions as SemanticClusterService) : undefined;
    this.topicTtlMs = resolvedOptions.topicTtlMs ?? DEFAULT_TOPIC_TTL;
    this.maxTopics = resolvedOptions.maxTopics ?? DEFAULT_MAX_TOPICS;
    this.mediumSignalThreshold = resolvedOptions.mediumSignalThreshold ?? DEFAULT_MEDIUM_SIGNAL_THRESHOLD;
  }

  hydrate(topics: ResearchTopic[]): void {
    if (!Array.isArray(topics)) return;
    // Basic validation to avoid corrupt memory
    this.topics = topics.filter(
      (t) => t && typeof t.id === "string" && t.status === "active" && Array.isArray(t.evidence),
    );
  }

  // === Region: Core Update Logic ===

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
      let group = signalsByKey.get(key);
      if (!group) {
        group = [];
        signalsByKey.set(key, group);
      }
      group.push(signal);
    }

    // 3. Process signal groups
    for (const [heuristicKey, group] of signalsByKey) {
      const highSalience = group.filter((s) => s.salience === "high");
      const mediumSalience = group.filter((s) => s.salience === "medium");

      if (highSalience.length > 0 || mediumSalience.length >= this.mediumSignalThreshold) {
        const primarySignal = highSalience[0] || mediumSalience[0];

        // 3.1 Extract Semantic Features (Formal NLP Layer)
        const features = this.semanticService
          ? await this.semanticService.extractFeatures(primarySignal.summary)
          : null;

        const semanticKey = features?.normalizedKey || heuristicKey;
        const existingTopic = this.topics.find(
          (t) => t.status === "active" && (t.id.includes(semanticKey) || this.isTopicRelated(t, primarySignal)),
        );

        if (existingTopic) {
          this.updateTopic(existingTopic, group, now);
          if (features) {
            const existingEntities = Array.isArray(existingTopic.metadata?.entities)
              ? existingTopic.metadata.entities.map((item) => String(item))
              : [];
            existingTopic.metadata = {
              ...existingTopic.metadata,
              entities: [...new Set([...existingEntities, ...features.entities.map((e) => e.name)])],
            };
          }
          if (!updatedTopics.includes(existingTopic)) {
            updatedTopics.push(existingTopic);
          }
        } else if (this.activeTopics().length < this.maxTopics) {
          const newTopic = this.createTopic(primarySignal, group, now, semanticKey);
          if (features) {
            newTopic.title = features.primaryTopic;
            newTopic.metadata = { ...newTopic.metadata, entities: features.entities.map((e) => e.name) };
          }
          this.topics.push(newTopic);
          addedTopics.push(newTopic);
        }
      }
    }

    return { addedTopics, updatedTopics, closedTopics };
  }

  activeTopics(): ResearchTopic[] {
    return this.topics.filter((t) => t.status === "active");
  }

  snapshot(): Record<string, unknown> {
    const active = this.activeTopics();
    return {
      activeResearchTopicsCount: active.length,
      activeResearchTopics: active.map((t) => ({
        id: t.id,
        title: truncateText(t.title, 60),
        priority: t.priority,
      })),
    };
  }

  // === Region: Helpers & Normalization ===

  private getNormalizedKey(signal: CognitiveSignal): string {
    const kind = (signal.kind || "unknown").toLowerCase().trim();
    const source = (signal.source || "unknown").toLowerCase().trim();
    const summary = (signal.summary || "none")
      .toLowerCase()
      .replace(NON_ALPHANUMERIC_REGEX, "")
      .trim()
      .split(WHITESPACE_REGEX)
      .slice(0, 2)
      .join("_");
    return `${kind}:${source}:${summary}`;
  }

  private isTopicRelated(topic: ResearchTopic, signal: CognitiveSignal): boolean {
    const key = this.getNormalizedKey(signal);
    const [kind] = key.split(":");

    if (topic.subjectKind === this.mapKindToSubject(kind)) {
      const signalWords = signal.summary.toLowerCase().split(WHITESPACE_REGEX);
      const titleWords = topic.title.toLowerCase().split(WHITESPACE_REGEX);
      for (const sw of signalWords) {
        if (sw.length > 2 && titleWords.includes(sw)) return true;
      }
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
      evidence: group.flatMap((s) => this.signalToEvidence(s)),
      openQuestions: [`Why is ${primary.summary} occurring?`],
      provisionalFindings: [],
      nextActions: [{ type: "observe", description: "Collect more evidence", status: "pending" }],
    };
  }

  private updateTopic(topic: ResearchTopic, group: CognitiveSignal[], now: number): void {
    topic.updatedAt = now;
    topic.expiresAt = now + this.topicTtlMs;

    for (const s of group) {
      const evidences = this.signalToEvidence(s);
      for (const e of evidences) {
        if (!topic.evidence.some((existing) => existing.timestamp === e.timestamp && existing.excerpt === e.excerpt)) {
          topic.evidence.push(e);
        }
      }
      if (s.salience === "high") {
        topic.priority = Math.min(5, topic.priority + 1);
      }
    }

    topic.confidence = Math.min(1.0, topic.confidence + group.length * 0.05);
    if (topic.evidence.length > 20) {
      topic.evidence = topic.evidence.slice(-20);
    }
  }

  private signalToEvidence(signal: CognitiveSignal): ResearchEvidence[] {
    if (signal.evidence && signal.evidence.length > 0) {
      return signal.evidence.map((e) => ({
        source: e.source || signal.source,
        excerpt: e.excerpt,
        timestamp: e.timestamp ?? signal.timestamp,
      }));
    }
    return [
      {
        source: signal.source,
        excerpt: signal.summary,
        timestamp: signal.timestamp,
      },
    ];
  }
}
