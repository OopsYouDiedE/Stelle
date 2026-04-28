import type { SelfModelSnapshot, SelfModelUpdateInput, SelfModelUpdate, ResearchTopic } from "./types.js";

export interface SelfModel {
  load(): Promise<SelfModelSnapshot>;
  update(input: SelfModelUpdateInput): Promise<SelfModelUpdate>;
  snapshot(): SelfModelSnapshot;
  hydrate(snapshot: Partial<SelfModelSnapshot>): void;
}

export class DefaultSelfModel implements SelfModel {
  private state: SelfModelSnapshot;
  private readonly maxConvictions: number;

  constructor(initial?: Partial<SelfModelSnapshot>, maxConvictions = 20) {
    this.maxConvictions = maxConvictions;
    this.state = {
      mood: "calm",
      currentFocus: "",
      activeConvictions: [],
      behavioralWarnings: [],
      styleBias: {
        replyBias: "normal",
        vibeIntensity: 3,
        preferredTempo: "normal"
      },
      ...initial
    };
    this.validateAndDegrade();
  }

  async load(): Promise<SelfModelSnapshot> {
    return { ...this.state };
  }

  snapshot(): SelfModelSnapshot {
    return { ...this.state };
  }

  hydrate(snapshot: Partial<SelfModelSnapshot>): void {
    this.state = {
      ...this.state,
      ...snapshot
    };
    this.validateAndDegrade();
  }

  async update(input: SelfModelUpdateInput): Promise<SelfModelUpdate> {
    const changes: string[] = [];
    const prevMood = this.state.mood;
    const prevFocus = this.state.currentFocus;

    // 1. Process Signals for Mood and Warnings
    if (input.signals && Array.isArray(input.signals)) {
      for (const signal of input.signals) {
        if (signal.salience === "high" && this.state.mood !== "alert") {
          this.state.mood = "alert";
          changes.push(`Mood raised to alert due to high salience signal: ${signal.summary}`);
        } else if (signal.impactScore > 7 && this.state.mood === "calm") {
          this.state.mood = "tense";
          changes.push(`Mood shifted to tense due to high impact signal: ${signal.summary}`);
        }

        // Add warning for sensitive/high impact signals
        if (signal.impactScore > 8 || (signal.summary && signal.summary.toLowerCase().includes("sensitive"))) {
          const warning = `Behavioral caution: ${signal.summary}`;
          if (!this.state.behavioralWarnings.includes(warning)) {
            this.state.behavioralWarnings.push(warning);
            changes.push(`Added behavioral warning: ${warning}`);
          }
        }
      }
    }

    // 2. Process Research Updates for Focus and Convictions
    if (input.researchUpdates) {
      const { addedTopics, updatedTopics } = input.researchUpdates;

      if (addedTopics && addedTopics.length > 0) {
        this.state.currentFocus = addedTopics[0].title;
        if (this.state.currentFocus !== prevFocus) {
          changes.push(`Focus shifted to new research topic: ${this.state.currentFocus}`);
        }
      }

      if (updatedTopics && Array.isArray(updatedTopics)) {
        for (const topic of updatedTopics) {
          this.applyTopicToConviction(topic, changes);
        }
      }
    }

    // Cap and Clamp
    this.validateAndDegrade();

    if (this.state.mood !== prevMood && !changes.some(c => c.includes("Mood"))) {
      changes.push(`Mood changed from ${prevMood} to ${this.state.mood}`);
    }

    return {
      snapshot: { ...this.state },
      changes
    };
  }

  private applyTopicToConviction(topic: ResearchTopic, changes: string[]): void {
    const existingIndex = this.state.activeConvictions.findIndex(c => c.topic === topic.title);
    
    if (existingIndex >= 0) {
      const conviction = this.state.activeConvictions[existingIndex];
      const oldConfidence = conviction.confidence;
      conviction.confidence = Math.min(1, conviction.confidence + 0.1);
      if (conviction.confidence !== oldConfidence) {
        changes.push(`Increased conviction confidence for "${topic.title}" to ${conviction.confidence.toFixed(2)}`);
      }
    } else {
      this.state.activeConvictions.push({
        topic: topic.title,
        stance: topic.provisionalFindings?.[0] || "Exploring this theme.",
        confidence: Math.max(0, Math.min(1, topic.confidence || 0.1))
      });
      changes.push(`Formed new conviction: ${topic.title}`);
    }
  }

  private validateAndDegrade(): void {
    if (typeof this.state.mood !== "string" || !this.state.mood.trim()) {
      this.state.mood = "calm";
    }
    if (typeof this.state.currentFocus !== "string") {
      this.state.currentFocus = "";
    }
    if (!Array.isArray(this.state.activeConvictions)) {
      this.state.activeConvictions = [];
    }
    if (!Array.isArray(this.state.behavioralWarnings)) {
      this.state.behavioralWarnings = [];
    }
    this.state.activeConvictions = this.state.activeConvictions
      .filter(c => c && typeof c.topic === "string" && typeof c.stance === "string")
      .map(c => ({
        topic: c.topic,
        stance: c.stance,
        confidence: typeof c.confidence === "number" ? c.confidence : 0.1
      }));
    this.state.behavioralWarnings = this.state.behavioralWarnings
      .filter(w => typeof w === "string" && w.trim().length > 0);

    // Clamp confidence
    for (const c of this.state.activeConvictions) {
      c.confidence = Math.max(0, Math.min(1, c.confidence));
    }

    // Cap convictions
    if (this.state.activeConvictions.length > this.maxConvictions) {
      // Sort by confidence and keep top ones
      this.state.activeConvictions.sort((a, b) => b.confidence - a.confidence);
      this.state.activeConvictions = this.state.activeConvictions.slice(0, this.maxConvictions);
    }

    // Limit warnings
    if (this.state.behavioralWarnings.length > 10) {
      this.state.behavioralWarnings = this.state.behavioralWarnings.slice(-10);
    }

    // Ensure styleBias defaults
    if (!this.state.styleBias) {
      this.state.styleBias = {
        replyBias: "normal",
        vibeIntensity: 3,
        preferredTempo: "normal"
      };
    }
  }
}
