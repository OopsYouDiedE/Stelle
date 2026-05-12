export type LlmProviderType = "dashscope" | "gemini" | "openai" | "custom";

export interface ModelProviderConfig {
  provider: LlmProviderType;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface ModelConfig {
  primary: ModelProviderConfig;
  secondary: ModelProviderConfig;
  fallback?: ModelProviderConfig;
  apiKey: string; // 后向兼容或全局 Key
}

const DEFAULT_DASHSCOPE_MODEL = "qwen-plus";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const EXPIRED_GEMINI_15_MODEL = /^gemini-1\.5-/;

export function loadModelConfig(rawYaml: Record<string, unknown>): ModelConfig {
  const geminiApiKey = process.env.GEMINI_API_KEY || "";
  const dashscopeApiKey = process.env.DASHSCOPE_API_KEY || "";
  const openaiApiKey = process.env.OPENAI_API_KEY || "";

  console.log(`[Config] GEMINI_API_KEY present: ${Boolean(geminiApiKey)}`);
  console.log(`[Config] DASHSCOPE_API_KEY present: ${Boolean(dashscopeApiKey)}`);

  const resolveProvider = (model: string): LlmProviderType => {
    if (model.startsWith("gemini")) return "gemini";
    return "dashscope";
  };
  
  const resolveConfig = (model: string): ModelProviderConfig => {
    const provider = resolveProvider(model);
    return {
      provider,
      model,
      apiKey: provider === "gemini" ? geminiApiKey : dashscopeApiKey,
      baseUrl:
        provider === "dashscope"
          ? process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
          : undefined,
    };
  };

  const defaultModel = dashscopeApiKey ? DEFAULT_DASHSCOPE_MODEL : DEFAULT_GEMINI_MODEL;
  const primaryModelRaw = process.env.STELLE_PRIMARY_MODEL || defaultModel;
  const secondaryModelRaw = process.env.STELLE_SECONDARY_MODEL || defaultModel;

  // 纠正明显的错误或已下线模型名，避免实时模拟退化到 fallback。
  const validateModel = (m: string) => {
    if (m.includes("gemma-4")) return defaultModel;
    if (EXPIRED_GEMINI_15_MODEL.test(m)) return DEFAULT_GEMINI_MODEL;
    return m;
  };

  const primaryModel = validateModel(primaryModelRaw);
  const secondaryModel = validateModel(secondaryModelRaw);

  console.log(`[Config] Final Model Selection -> Primary: ${primaryModel}, Secondary: ${secondaryModel}`);

  return {
    primary: resolveConfig(primaryModel),
    secondary: resolveConfig(secondaryModel),
    fallback: dashscopeApiKey
      ? resolveConfig(DEFAULT_DASHSCOPE_MODEL)
      : geminiApiKey
        ? resolveConfig(DEFAULT_GEMINI_MODEL)
        : undefined,
    apiKey: geminiApiKey || dashscopeApiKey || openaiApiKey,
  };
}
