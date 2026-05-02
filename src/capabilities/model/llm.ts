//#region Imports
import { safeErrorMessage } from "../../shared/json.js";
import type { ModelConfig, ModelProviderConfig, LlmProviderType } from "../../config/index.js";
//#endregion

//#region Types & Interfaces

/**
 * Role of the LLM call: primary (usually more powerful) or secondary (cheaper/faster).
 */
export type LlmRole = "primary" | "secondary";

/**
 * Options for LLM text/JSON generation.
 */
export interface LlmOptions {
  role?: LlmRole;
  temperature?: number;
  maxOutputTokens?: number;
  safeDefault?: unknown;
}

/**
 * Internal interface for LLM provider drivers.
 */
interface LlmProvider {
  generateText(prompt: string, config: ModelProviderConfig, options: LlmOptions): Promise<string>;
}

//#endregion

//#region Provider Base

/**
 * Base class for LLM providers to share common fetching logic.
 */
abstract class BaseLlmProvider implements LlmProvider {
  protected async request(url: string, body: unknown, headers: Record<string, string> = {}): Promise<any> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`[${this.constructor.name}] ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  abstract generateText(prompt: string, config: ModelProviderConfig, options: LlmOptions): Promise<string>;
}

//#endregion

//#region Provider Implementations

/**
 * Provider for OpenAI-compatible APIs (DashScope, OpenAI, etc.)
 */
class OpenAiCompatibleProvider extends BaseLlmProvider {
  async generateText(prompt: string, config: ModelProviderConfig, options: LlmOptions): Promise<string> {
    const data = await this.request(
      `${config.baseUrl}/chat/completions`,
      {
        model: config.model,
        messages: [{ role: "user", content: prompt }],
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxOutputTokens ?? 1000,
      },
      { Authorization: `Bearer ${config.apiKey}` },
    );
    return data.choices?.[0]?.message?.content || "";
  }
}

/**
 * Provider for Google Gemini API.
 */
class GeminiProvider extends BaseLlmProvider {
  async generateText(prompt: string, config: ModelProviderConfig, options: LlmOptions): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
    const data = await this.request(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxOutputTokens ?? 1000,
      },
    });
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }
}

//#endregion

//#region LlmClient

/**
 * Core LLM client for Stelle. Handles provider switching, fallback logic, and robust JSON generation.
 */
export class LlmClient {
  //#region Properties & Constants

  /**
   * Static provider map to avoid re-instantiation.
   */
  private static readonly PROVIDER_INSTANCES: Record<LlmProviderType, LlmProvider> = {
    dashscope: new OpenAiCompatibleProvider(),
    gemini: new GeminiProvider(),
    openai: new OpenAiCompatibleProvider(),
    custom: new OpenAiCompatibleProvider(),
  };

  //#endregion

  constructor(readonly config: ModelConfig) {}

  //#region Public Methods

  /**
   * Generates text from the LLM with fallback support.
   */
  public async generateText(prompt: string, options: LlmOptions = {}): Promise<string> {
    const role = options.role || "secondary";
    const primaryConfig = role === "primary" ? this.config.primary : this.config.secondary;

    // Build fallback chain: Primary/Secondary -> Fallback
    const configs = [primaryConfig, this.config.fallback].filter((c): c is ModelProviderConfig =>
      Boolean(c && c.apiKey),
    );

    let lastError: Error | null = null;
    for (const config of configs) {
      try {
        const provider = LlmClient.PROVIDER_INSTANCES[config.provider];
        if (!provider) throw new Error(`Unknown provider: ${config.provider}`);
        return await provider.generateText(prompt, config, options);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(
          `[LLM] Call failed for ${config.model} (${config.provider}): ${lastError.message}. Trying next fallback...`,
        );
      }
    }

    throw lastError || new Error("All LLM providers failed.");
  }

  /**
   * Generates a typed object from the LLM with robust parsing and automatic repair.
   */
  public async generateJson<T>(
    prompt: string,
    schemaName: string,
    normalize: (raw: unknown) => T,
    options: LlmOptions = {},
  ): Promise<T> {
    const jsonPrompt = `${prompt}\n\nIMPORTANT: Return ONLY valid JSON that matches the schema. No markdown tags.`;
    const raw = await this.generateText(jsonPrompt, options);

    // Phase 1: Direct or Extraction-based parsing
    const parsed = this.tryParseJson(raw);
    if (parsed.ok) return normalize(parsed.value);

    // Phase 2: Automatic Repair
    try {
      const repairPrompt = [
        "Repair the following malformed model output into ONLY valid JSON.",
        "Do not add commentary, markdown, explanations, or fields not implied by the content.",
        `Target schema name: ${schemaName}`,
        "Malformed output:",
        raw,
      ].join("\n\n");

      const repairedRaw = await this.generateText(repairPrompt, {
        role: "secondary",
        temperature: 0,
        maxOutputTokens: options.maxOutputTokens,
      });

      const repaired = this.tryParseJson(repairedRaw);
      if (repaired.ok) return normalize(repaired.value);
    } catch (repairError) {
      console.warn(`[LLM] JSON repair failed for schema ${schemaName}: ${safeErrorMessage(repairError)}`);
    }

    // Phase 3: Safe Default or Failure
    if ("safeDefault" in options) {
      console.warn(
        `[LLM] JSON Parse failed for schema ${schemaName}. Returning safe default. Raw: ${raw.substring(0, 100)}...`,
      );
      return normalize(options.safeDefault);
    }

    console.error(`[LLM] JSON Parse failed for schema ${schemaName}. Raw: ${raw.substring(0, 100)}...`);
    throw new Error(
      `Failed to generate valid JSON for ${schemaName}: ${parsed.error ? safeErrorMessage(parsed.error) : "Unknown error"}`,
    );
  }

  //#endregion

  //#region Private Helpers

  /**
   * Attempts multiple strategies to extract and parse JSON from text.
   */
  private tryParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: unknown } {
    // 1. Try cleaning and direct parse
    const clean = text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    try {
      return { ok: true, value: JSON.parse(clean) };
    } catch (directError) {
      // 2. Try scanning for the first JSON-like structure
      const extracted = extractFirstJsonValue(text);
      if (extracted) {
        try {
          return { ok: true, value: JSON.parse(extracted) };
        } catch (extractError) {
          return { ok: false, error: extractError };
        }
      }
      return { ok: false, error: directError };
    }
  }

  //#endregion
}

//#endregion

//#region JSON Extraction Helpers

/**
 * Scans text for the first JSON object or array and returns the raw string.
 */
function extractFirstJsonValue(text: string): string | null {
  const clean = text.replace(/```json/gi, "").replace(/```/g, "");
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch !== "{" && ch !== "[") continue;

    const extracted = scanJsonValue(clean, i);
    if (extracted) return extracted;
  }
  return null;
}

/**
 * Brute-force JSON structure scanner using brace/bracket counting.
 */
function scanJsonValue(text: string, start: number): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{" || ch === "[") {
      stack.push(ch === "{" ? "}" : "]");
      continue;
    }

    if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return null;
      if (stack.length === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

//#endregion
