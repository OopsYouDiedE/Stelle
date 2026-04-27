import { safeErrorMessage } from "./json.js";
import type { ModelConfig, ModelProviderConfig, LlmProviderType } from "./config_loader.js";

export type LlmRole = "primary" | "secondary";

export interface LlmOptions {
  role?: LlmRole;
  temperature?: number;
  maxOutputTokens?: number;
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
    
    try {
      // 兼容某些模型带 markdown code block 的情况
      const cleanJson = raw.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleanJson);
      return normalize(parsed);
    } catch (error) {
      console.error(`[LLM] JSON Parse failed for schema ${schemaName}. Raw: ${raw.substring(0, 100)}...`);
      throw new Error(`Failed to generate valid JSON for ${schemaName}: ${safeErrorMessage(error)}`);
    }
  }
}
