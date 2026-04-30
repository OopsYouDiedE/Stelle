import { safeErrorMessage } from "../utils/json.js";
import type { ModelConfig, ModelProviderConfig, LlmProviderType } from "../config/index.js";

export type LlmRole = "primary" | "secondary";

export interface LlmOptions {
  role?: LlmRole;
  temperature?: number;
  maxOutputTokens?: number;
  safeDefault?: unknown;
}

/**
 * 接口：LlmProvider (供应商驱动)
 */
interface LlmProvider {
  generateText(prompt: string, config: ModelProviderConfig, options: LlmOptions): Promise<string>;
}

/**
 * 供应商实现：DashScope (OpenAI 兼容模式)
 */
class DashScopeProvider implements LlmProvider {
  async generateText(prompt: string, config: ModelProviderConfig, options: LlmOptions): Promise<string> {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: prompt }],
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxOutputTokens ?? 1000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DashScope error (${response.status}): ${error}`);
    }

    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content || "";
  }
}

/**
 * 供应商实现：Gemini
 */
class GeminiProvider implements LlmProvider {
  async generateText(prompt: string, config: ModelProviderConfig, options: LlmOptions): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxOutputTokens ?? 1000,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini error (${response.status}): ${error}`);
    }

    const data = await response.json() as any;
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }
}

/**
 * 模块：Stelle LLM Client
 */
export class LlmClient {
  private readonly providers: Record<LlmProviderType, LlmProvider> = {
    dashscope: new DashScopeProvider(),
    gemini: new GeminiProvider(),
    openai: new DashScopeProvider(), // OpenAI 同样走通用流程
    custom: new DashScopeProvider(),
  };

  constructor(readonly config: ModelConfig) {}

  public async generateText(prompt: string, options: LlmOptions = {}): Promise<string> {
    const role = options.role || "secondary";
    const primaryConfig = role === "primary" ? this.config.primary : this.config.secondary;

    // 重点改进 (P5): 真正的 Fallback 链路：Primary/Secondary -> Fallback
    const configs = [primaryConfig, this.config.fallback].filter((c): c is ModelProviderConfig => Boolean(c && c.apiKey));

    let lastError: Error | null = null;
    for (const config of configs) {
      try {
        const provider = this.providers[config.provider];
        if (!provider) throw new Error(`Unknown provider: ${config.provider}`);
        return await provider.generateText(prompt, config, options);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`[LLM] Call failed for ${config.model} (${config.provider}): ${lastError.message}. Trying next fallback...`);
      }
    }

    throw lastError || new Error("All LLM providers failed.");
  }

  public async generateJson<T>(
    prompt: string,
    schemaName: string,
    normalize: (raw: unknown) => T,
    options: LlmOptions = {}
  ): Promise<T> {
    const jsonPrompt = `${prompt}\n\nIMPORTANT: Return ONLY valid JSON that matches the schema. No markdown tags.`;
    const raw = await this.generateText(jsonPrompt, options);

    const direct = parseJsonLenient(raw);
    if (direct.ok) return normalize(direct.value);

    const extracted = extractFirstJsonValue(raw);
    if (extracted) {
      const parsed = parseJsonLenient(extracted);
      if (parsed.ok) return normalize(parsed.value);
    }

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
      const repaired = parseJsonLenient(repairedRaw);
      if (repaired.ok) return normalize(repaired.value);
      const repairedExtracted = extractFirstJsonValue(repairedRaw);
      if (repairedExtracted) {
        const parsed = parseJsonLenient(repairedExtracted);
        if (parsed.ok) return normalize(parsed.value);
      }
    } catch (repairError) {
      console.warn(`[LLM] JSON repair failed for schema ${schemaName}: ${safeErrorMessage(repairError)}`);
    }

    if ("safeDefault" in options) {
      console.warn(`[LLM] JSON Parse failed for schema ${schemaName}. Returning safe default. Raw: ${raw.substring(0, 100)}...`);
      return normalize(options.safeDefault);
    }

    console.error(`[LLM] JSON Parse failed for schema ${schemaName}. Raw: ${raw.substring(0, 100)}...`);
    throw new Error(`Failed to generate valid JSON for ${schemaName}: ${safeErrorMessage(direct.error)}`);
  }
}

function parseJsonLenient(text: string): { ok: true; value: unknown } | { ok: false; error: unknown } {
  try {
    const cleanJson = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    return { ok: true, value: JSON.parse(cleanJson) };
  } catch (error) {
    return { ok: false, error };
  }
}

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
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
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
