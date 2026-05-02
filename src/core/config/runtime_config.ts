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
  apiKey: string;
}

export interface RuntimeConfig {
  models: ModelConfig;
  discord: {
    enabled: boolean;
    token?: string;
    ambientEnabled: boolean;
    maxReplyChars: number;
    cooldownSeconds: number;
  };
  live: {
    enabled: boolean;
    rendererHost: string;
    rendererPort: number;
    ttsEnabled: boolean;
    obsControlEnabled: boolean;
    speechQueueLimit: number;
    platforms: {
      bilibili: { enabled: boolean; roomId?: string };
      twitch: { enabled: boolean; channel?: string; username?: string; oauthToken?: string; trackJoins?: boolean };
      youtube: {
        enabled: boolean;
        liveChatId?: string;
        videoId?: string;
        apiKey?: string;
        oauthToken?: string;
        forwardHistory?: boolean;
      };
      tiktok: {
        enabled: boolean;
        username?: string;
        provider?: "websocket" | "tiktok-live-connector";
        webSocketUrl?: string;
        apiKey?: string;
      };
    };
    thanks: unknown;
    idle: unknown;
    schedule: unknown;
  };
  expression: {
    stageOutput: {
      speechQueueLimit: number;
    };
  };
  program: {
    stageDirector: {
      thanks: unknown;
      idle: unknown;
      schedule: unknown;
    };
  };
  browser: { enabled: boolean; allowlist?: unknown };
  desktopInput: { enabled: boolean; allowlist?: unknown };
  android: { enabled: boolean; allowlist?: unknown };
  sceneObservation: { enabled: boolean };
  core: {
    reflectionIntervalHours: number;
    reflectionAccumulationThreshold: number;
  };
  debug: {
    enabled: boolean;
    requireToken: boolean;
    token?: string;
    allowExternalWrite: boolean;
  };
  control: {
    requireToken: boolean;
    token?: string;
  };
  rawYaml: Record<string, unknown>;
}
