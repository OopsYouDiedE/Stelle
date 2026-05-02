/**
 * Module: Semantic clustering and entity extraction service.
 */

// === Imports ===
import { asRecord } from "../../../shared/json.js";

export interface SemanticContext {
  llm: {
    generateJson<T>(
      prompt: string,
      schemaName: string,
      parser: (raw: unknown) => T,
      options?: Record<string, unknown>,
    ): Promise<T>;
  };
}

// === Types & Interfaces ===

/**
 * Represents a semantic entity extracted from text.
 */
export interface SemanticEntity {
  /** The name of the entity (e.g., "Kafka", "HSR") */
  name: string;
  /** Category of the entity (e.g., "character", "game", "topic") */
  category: string;
  /** Importance of the entity in the context (0.0 to 1.0) */
  salience: number;
}

/**
 * The result of a semantic clustering operation.
 */
export interface SemanticClusterResult {
  /** The main topic identified in the text */
  primaryTopic: string;
  /** List of entities extracted */
  entities: SemanticEntity[];
  /** A machine-readable key for the topic (snake_case) */
  normalizedKey: string;
}

// === Core Logic ===

/**
 * SemanticClusterService
 * 
 * Uses LLM to extract structured entities and topics for clustering,
 * replacing simple string-based clustering.
 */
export class SemanticClusterService {
  constructor(private readonly context: SemanticContext) {}

  /**
   * Extracts semantic features from the given text for clustering purposes.
   * 
   * @param text - The raw text to analyze.
   * @returns A Promise resolving to the semantic cluster result.
   */
  public async extractFeatures(text: string): Promise<SemanticClusterResult> {
    const prompt = [
      "Extract semantic entities and a primary topic for clustering from the following text.",
      "Identify key characters, events, or abstract concepts.",
      `Text:\n${text}`,
      'Return JSON: {"primaryTopic":"...","entities":[{"name":"...","category":"...","salience":0-1}],"normalizedKey":"lower_case_snake_case_topic"}'
    ].join("\n\n");

    try {
      const result = await this.context.llm.generateJson(
        prompt,
        "semantic_feature_extraction",
        (raw) => {
          const v = asRecord(raw);
          return {
            primaryTopic: String(v.primaryTopic || "unknown"),
            entities: Array.isArray(v.entities) ? v.entities.map(e => ({
              name: String(asRecord(e).name || "unknown"),
              category: String(asRecord(e).category || "unknown"),
              salience: Number(asRecord(e).salience ?? 0.5)
            })) : [],
            normalizedKey: String(v.normalizedKey || "unknown")
          };
        },
        { role: "secondary", temperature: 0.2, maxOutputTokens: 300 }
      );
      return result;
    } catch (e) {
      console.error("[SemanticClusterService] Extraction failed:", e);
      return { primaryTopic: "unknown", entities: [], normalizedKey: "unknown" };
    }
  }
}
