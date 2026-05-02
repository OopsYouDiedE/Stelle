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

export function loadModelConfig(rawYaml: Record<string, unknown>): ModelConfig {
  const geminiApiKey = process.env.GEMINI_API_KEY || "";
  const dashscopeApiKey = process.env.DASHSCOPE_API_KEY || "";
  const openaiApiKey = process.env.OPENAI_API_KEY || "";

  const resolveProvider = (model: string): LlmProviderType => (model.startsWith("gemini") ? "gemini" : "dashscope");
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

  const primaryModel = process.env.STELLE_PRIMARY_MODEL || "qwen-max";
  const secondaryModel = process.env.STELLE_SECONDARY_MODEL || "qwen-plus";

  return {
    primary: resolveConfig(primaryModel),
    secondary: resolveConfig(secondaryModel),
    fallback: {
      provider: "dashscope",
      model: "qwen-plus",
      apiKey: dashscopeApiKey,
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    apiKey: dashscopeApiKey || geminiApiKey || openaiApiKey,
  };
}
