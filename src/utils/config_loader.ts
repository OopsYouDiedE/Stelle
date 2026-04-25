/**
 * 模块：配置加载器
 *
 * 运行逻辑：
 * - `config.yaml` 提供非敏感、可提交的静态配置。
 * - 环境变量提供 token、API key、端口等运行时私密/部署参数。
 * - 这里只做解析、默认值和 clamp，不做业务判断。
 *
 * 主要方法：
 * - `loadRuntimeConfig()`：合并 yaml 与环境变量，返回 RuntimeConfig。
 * - `loadYamlConfig()`：读取根目录 yaml。
 * - `loadModelConfig()`：读取 Gemini/模型相关环境变量。
 */
import fs from "node:fs";
import YAML from "yaml";
import { asRecord, asString, clamp } from "./json.js";

export interface ModelConfig {
  apiKey: string;
  baseUrl?: string;
  primaryModel: string;
  secondaryModel: string;
  ttsModel: string;
}

export interface DiscordConfig {
  token?: string;
  ownerUserId?: string;
  testChannelId?: string;
  ambientEnabled: boolean;
  maxReplyChars: number;
  cooldownSeconds: number;
  dmSilenceSeconds: number;
}

export interface LiveConfig {
  rendererHost: string;
  rendererPort: number;
  defaultModel?: string;
  ttsEnabled: boolean;
  obsControlEnabled: boolean;
  speechQueueLimit: number;
}

export interface CoreConfig {
  reflectionIntervalHours: number;
  reflectionAccumulationThreshold: number;
}

export interface RuntimeConfig {
  models: ModelConfig;
  discord: DiscordConfig;
  live: LiveConfig;
  core: CoreConfig;
  rawYaml: Record<string, unknown>;
}

const DEFAULT_PRIMARY_MODEL = "gemma-4-31b-it";
const DEFAULT_SECONDARY_MODEL = "gemma-4-31b-it";
const DEFAULT_TTS_MODEL = "gemini-3.1-flash-tts-preview";

export function loadRuntimeConfig(path = "config.yaml"): RuntimeConfig {
  const rawYaml = loadYamlConfig(path);
  const cursors = asRecord(rawYaml.cursors);
  const discordCursor = asRecord(cursors.discord);
  const liveCursor = asRecord(cursors.live);
  const core = asRecord(rawYaml.core);

  return {
    models: loadModelConfig(),
    discord: {
      token: process.env.DISCORD_TOKEN,
      ownerUserId: process.env.DISCORD_OWNER_USER_ID,
      testChannelId: process.env.DISCORD_TEST_CHANNEL_ID,
      ambientEnabled: discordCursor.ambientEnabled !== false,
      maxReplyChars: clamp(discordCursor.maxReplyChars ?? process.env.DISCORD_MAX_REPLY_CHARS, 100, 4000, 900),
      cooldownSeconds: clamp(discordCursor.cooldownSeconds ?? process.env.DISCORD_COOLDOWN_SECONDS, 0, 3600, 240),
      dmSilenceSeconds: clamp(discordCursor.dmSilenceSeconds ?? process.env.DISCORD_DM_SILENCE_SECONDS, 0, 60, 4),
    },
    live: {
      rendererHost: asString(process.env.LIVE_RENDERER_HOST) ?? "127.0.0.1",
      rendererPort: clamp(process.env.LIVE_RENDERER_PORT, 1, 65535, 8787),
      defaultModel: asString(liveCursor.defaultModel) ?? asString(process.env.LIVE_DEFAULT_MODEL),
      ttsEnabled: (liveCursor.ttsEnabled ?? process.env.LIVE_TTS_ENABLED) !== false && process.env.LIVE_TTS_ENABLED !== "false",
      obsControlEnabled: liveCursor.obsControlEnabled === true || process.env.OBS_CONTROL_ENABLED === "true",
      speechQueueLimit: clamp(liveCursor.speechQueueLimit, 1, 100, 12),
    },
    core: {
      reflectionIntervalHours: clamp(core.reflectionIntervalHours, 1, 168, 6),
      reflectionAccumulationThreshold: clamp(core.reflectionAccumulationThreshold, 1, 10000, 30),
    },
    rawYaml,
  };
}

export function loadYamlConfig(path = "config.yaml"): Record<string, unknown> {
  if (!fs.existsSync(path)) return {};
  return asRecord(YAML.parse(fs.readFileSync(path, "utf8")));
}

export function loadModelConfig(): ModelConfig {
  const apiKey = firstDefined(process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY, process.env.AISTUDIO_API_KEY);
  return {
    apiKey,
    baseUrl: normalizeBaseUrl(firstDefined(process.env.GEMINI_BASE_URL, process.env.AISTUDIO_BASE_URL)) || undefined,
    primaryModel: process.env.STELLE_PRIMARY_MODEL || DEFAULT_PRIMARY_MODEL,
    secondaryModel: process.env.STELLE_SECONDARY_MODEL || DEFAULT_SECONDARY_MODEL,
    ttsModel: process.env.STELLE_TTS_MODEL || DEFAULT_TTS_MODEL,
  };
}

function firstDefined(...values: Array<string | undefined>): string {
  return values.find((value) => typeof value === "string" && value.length > 0) ?? "";
}

function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl) return "";
  try {
    const url = new URL(baseUrl);
    if (url.hostname.includes("generativelanguage.googleapis.com")) {
      return `${url.protocol}//${url.hostname}`;
    }
    return baseUrl.replace(/\/+$/, "");
  } catch {
    return baseUrl.replace(/\/+$/, "");
  }
}
