import "dotenv/config";
import { LlmClient } from "../../src/capabilities/model/llm.js";
import type { ModelConfig, ModelProviderConfig } from "../../src/config/index.js";

const DASH_SCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

export function hasEvalLlmKeys(): boolean {
  if (process.env.STELLE_EVAL_DISABLE === "1") return false;
  // Exclusively check for Dashscope key as requested
  return Boolean(validKey(process.env.DASHSCOPE_API_KEY));
}

export function evalModelLabel(): string {
  if (validKey(process.env.DASHSCOPE_API_KEY)) {
    return process.env.STELLE_EVAL_MODEL || "qwen-plus";
  }
  return "no-eval-model";
}

export function makeEvalModelConfig(): ModelConfig {
  const dashscopeApiKey = process.env.DASHSCOPE_API_KEY || "";

  const primary = provider("dashscope", process.env.STELLE_EVAL_MODEL || "qwen-plus", dashscopeApiKey);
  const secondary = provider("dashscope", process.env.STELLE_EVAL_SECONDARY_MODEL || primary.model, dashscopeApiKey);
  const fallback = provider("dashscope", process.env.STELLE_EVAL_FALLBACK_MODEL || "qwen-plus", dashscopeApiKey);

  return {
    primary,
    secondary,
    fallback,
    apiKey: primary.apiKey,
  };
}

export function makeEvalLlm(): LlmClient {
  return new LlmClient(makeEvalModelConfig());
}

function provider(providerName: "gemini" | "dashscope", model: string, apiKey: string): ModelProviderConfig {
  return {
    provider: providerName,
    model,
    apiKey,
    baseUrl: providerName === "dashscope" ? process.env.QWEN_BASE_URL || DASH_SCOPE_BASE_URL : undefined,
  };
}

function validKey(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized && normalized !== "test-key" && normalized !== "dummy" && normalized !== "your_key_here");
}
