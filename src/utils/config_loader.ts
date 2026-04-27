/**
 * 模块：配置加载器
 */
import fs from "node:fs";
import YAML from "yaml";
import { asRecord, asString, clamp } from "./json.js";

export interface ModelConfig {
  apiKey: string;
  geminiApiKey: string;
  dashscopeApiKey: string;
  baseUrl: string;
  primaryModel: string;
  secondaryModel: string;
}

export interface DiscordConfig {
  token?: string;
  ambientEnabled: boolean;
  maxReplyChars: number;
  cooldownSeconds: number;
}

export interface LiveConfig {
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

export interface RuntimeConfig {
  models: ModelConfig;
  discord: DiscordConfig;
  live: LiveConfig;
  core: CoreConfig;
  rawYaml: Record<string, unknown>;
}

export function loadRuntimeConfig(): RuntimeConfig {
  const rawYaml = loadYamlConfig();
  const cursors = asRecord(rawYaml.cursors);
  const discordCursor = asRecord(cursors.discord);
  const liveCursor = asRecord(cursors.live);
  const core = asRecord(rawYaml.core);

  const geminiApiKey = process.env.GEMINI_API_KEY || "";
  const dashscopeApiKey = process.env.DASHSCOPE_API_KEY || "";
  const modelApiKey = dashscopeApiKey || geminiApiKey;

  return {
    models: {
      apiKey: modelApiKey,
      geminiApiKey,
      dashscopeApiKey,
      baseUrl: process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
      primaryModel: process.env.STELLE_PRIMARY_MODEL || "qwen-max",
      secondaryModel: process.env.STELLE_SECONDARY_MODEL || "qwen-plus",
    },
    discord: {
      token: process.env.DISCORD_TOKEN,
      ambientEnabled: discordCursor.ambientEnabled !== false,
      maxReplyChars: clamp(Number(discordCursor.maxReplyChars || 900), 100, 4000, 900),
      cooldownSeconds: clamp(Number(discordCursor.cooldownSeconds || 240), 0, 3600, 240),
    },
    live: {
      rendererHost: asString(process.env.LIVE_RENDERER_HOST) ?? "127.0.0.1",
      rendererPort: clamp(process.env.LIVE_RENDERER_PORT ?? liveCursor.rendererPort, 1, 65535, 8787),
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

export function loadYamlConfig(filePath = "config.yaml"): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  return asRecord(YAML.parse(fs.readFileSync(filePath, "utf8")));
}

export function loadModelConfig() {
  return loadRuntimeConfig().models;
}
