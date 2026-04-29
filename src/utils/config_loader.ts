/**
 * 模块：配置加载器
 */
import fs from "node:fs";
import YAML from "yaml";
import { asRecord, asString, clamp } from "./json.js";

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

export interface DiscordConfig {
  enabled: boolean;
  token?: string;
  ambientEnabled: boolean;
  maxReplyChars: number;
  cooldownSeconds: number;
}

export interface LiveConfig {
  enabled: boolean;
  rendererHost: string;
  rendererPort: number;
  ttsEnabled: boolean;
  obsControlEnabled: boolean;
  speechQueueLimit: number;
}

export interface CoreConfig {
  reflectionIntervalHours: number;
  reflectionAccumulationThreshold: number;
}

export interface DebugConfig {
  enabled: boolean;
  requireToken: boolean;
  token?: string;
  allowExternalWrite: boolean;
}

export interface ControlConfig {
  requireToken: boolean;
  token?: string;
}

export interface BrowserConfig {
  enabled: boolean;
  allowlist?: {
    cursors?: string[];
    resources?: string[];
    resourceKinds?: string[];
    risks?: string[];
  };
}

export interface DesktopInputConfig {
  enabled: boolean;
  allowlist?: {
    cursors?: string[];
    resources?: string[];
    resourceKinds?: string[];
    risks?: string[];
  };
}

export interface AndroidConfig {
  enabled: boolean;
  allowlist?: {
    cursors?: string[];
    resources?: string[];
    resourceKinds?: string[];
    risks?: string[];
  };
}

export interface RuntimeConfig {
  models: ModelConfig;
  discord: DiscordConfig;
  live: LiveConfig;
  browser: BrowserConfig;
  desktopInput: DesktopInputConfig;
  android: AndroidConfig;
  core: CoreConfig;
  debug: DebugConfig;
  control: ControlConfig;
  rawYaml: Record<string, unknown>;
}

export function loadRuntimeConfig(): RuntimeConfig {
  const rawYaml = loadYamlConfig();
  const cursors = asRecord(rawYaml.cursors);
  
  // Cursor aliases. Canonical module ids override short aliases when both are present.
  const discordCursor = mergeRecords(asRecord(cursors.discord), asRecord(cursors.discord_text_channel));
  const liveCursor = mergeRecords(asRecord(cursors.live), asRecord(cursors.live_danmaku));
  const browserCursor = asRecord(cursors.browser);
  const desktopInputCursor = asRecord(cursors.desktop_input || cursors.desktopInput);
  const androidCursor = asRecord(cursors.android || cursors.android_device || cursors.androidDevice);
  
  const core = asRecord(rawYaml.core);
  const debug = asRecord(rawYaml.debug);
  const control = asRecord(rawYaml.control);

  const geminiApiKey = process.env.GEMINI_API_KEY || "";
  const dashscopeApiKey = process.env.DASHSCOPE_API_KEY || "";
  const openaiApiKey = process.env.OPENAI_API_KEY || "";

  // 优先级推断逻辑 (P5)
  const primaryModel = process.env.STELLE_PRIMARY_MODEL || "qwen-max";
  const primaryProvider: LlmProviderType = primaryModel.startsWith("gemini") ? "gemini" : "dashscope";
  
  const secondaryModel = process.env.STELLE_SECONDARY_MODEL || "qwen-plus";
  const secondaryProvider: LlmProviderType = secondaryModel.startsWith("gemini") ? "gemini" : "dashscope";

  const debugToken = process.env.STELLE_DEBUG_TOKEN || asString(debug.token) || undefined;

  return {
    models: {
      primary: {
        provider: primaryProvider,
        model: primaryModel,
        apiKey: primaryProvider === "gemini" ? geminiApiKey : dashscopeApiKey,
        baseUrl: primaryProvider === "dashscope" ? (process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1") : undefined
      },
      secondary: {
        provider: secondaryProvider,
        model: secondaryModel,
        apiKey: secondaryProvider === "gemini" ? geminiApiKey : dashscopeApiKey,
        baseUrl: secondaryProvider === "dashscope" ? (process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1") : undefined
      },
      fallback: {
        provider: "dashscope",
        model: "qwen-plus",
        apiKey: dashscopeApiKey,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1"
      },
      apiKey: dashscopeApiKey || geminiApiKey || openaiApiKey,
    },
    discord: {
      enabled: discordCursor.enabled !== false,
      token: process.env.DISCORD_TOKEN,
      ambientEnabled: discordCursor.ambientEnabled !== false,
      maxReplyChars: clamp(Number(discordCursor.maxReplyChars || 900), 100, 4000, 900),
      cooldownSeconds: clamp(Number(discordCursor.cooldownSeconds || 240), 0, 3600, 240),
    },
    live: {
      enabled: liveCursor.enabled !== false,
      rendererHost: asString(process.env.LIVE_RENDERER_HOST) ?? "127.0.0.1",
      rendererPort: clamp(process.env.LIVE_RENDERER_PORT ?? liveCursor.rendererPort, 1, 65535, 8787),
      ttsEnabled: (liveCursor.ttsEnabled ?? process.env.LIVE_TTS_ENABLED) !== false && process.env.LIVE_TTS_ENABLED !== "false",
      obsControlEnabled: liveCursor.obsControlEnabled === true || process.env.OBS_CONTROL_ENABLED === "true",
      speechQueueLimit: clamp(process.env.LIVE_SPEECH_QUEUE_LIMIT ?? liveCursor.speechQueueLimit, 1, 12, 3),
    },
    browser: {
      enabled: browserCursor.enabled === true || process.env.BROWSER_ENABLED === "true",
      allowlist: asRecord(browserCursor.allowlist) as any,
    },
    desktopInput: {
      enabled: desktopInputCursor.enabled === true || process.env.DESKTOP_INPUT_ENABLED === "true",
      allowlist: asRecord(desktopInputCursor.allowlist) as any,
    },
    android: {
      enabled: androidCursor.enabled === true || process.env.ANDROID_DEVICE_ENABLED === "true",
      allowlist: asRecord(androidCursor.allowlist) as any,
    },
    core: {
      reflectionIntervalHours: clamp(core.reflectionIntervalHours, 1, 168, 6),
      reflectionAccumulationThreshold: clamp(core.reflectionAccumulationThreshold, 1, 10000, 30),
    },
    debug: {
      enabled: process.env.STELLE_DEBUG_ENABLED === "true" || debug.enabled === true,
      requireToken: process.env.STELLE_DEBUG_REQUIRE_TOKEN !== "false" && debug.requireToken !== false,
      token: debugToken,
      allowExternalWrite: process.env.STELLE_DEBUG_ALLOW_EXTERNAL_WRITE === "true" || debug.allowExternalWrite === true,
    },
    control: {
      requireToken: process.env.STELLE_CONTROL_REQUIRE_TOKEN !== "false" && control.requireToken !== false,
      token: process.env.STELLE_CONTROL_TOKEN || asString(control.token) || debugToken,
    },
    rawYaml,
  };
}

export function loadYamlConfig(filePath = "config.yaml"): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  return asRecord(YAML.parse(fs.readFileSync(filePath, "utf8")));
}

export function loadModelConfig() {
  return loadRuntimeConfig().models;
}

function mergeRecords(...records: Record<string, unknown>[]): Record<string, unknown> {
  return Object.assign({}, ...records);
}
