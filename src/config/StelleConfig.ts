import fs from "node:fs";
import YAML from "yaml";

export const PRIMARY_GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
export const SECONDARY_GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
export const GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";

export interface StelleModelConfig {
  apiKey: string;
  baseUrl?: string;
  primaryModel: string;
  secondaryModel: string;
  ttsModel: string;
}

interface RawConfig {
  guilds?: Record<string, { api_key?: string; base_url?: string; model?: string }>;
}

export function loadRawConfig(path = "config.yaml"): RawConfig {
  if (!fs.existsSync(path)) return {};
  return YAML.parse(fs.readFileSync(path, "utf8")) as RawConfig;
}

export function loadStelleModelConfig(path = "config.yaml"): StelleModelConfig {
  const raw = loadRawConfig(path);
  const firstGuild = Object.values(raw.guilds ?? {})[0];
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.AISTUDIO_API_KEY ||
    firstGuild?.api_key ||
    "";
  return {
    apiKey,
    baseUrl: normalizeGeminiBaseUrl(process.env.GEMINI_BASE_URL || process.env.AISTUDIO_BASE_URL || firstGuild?.base_url),
    primaryModel: process.env.STELLE_PRIMARY_MODEL || PRIMARY_GEMINI_MODEL,
    secondaryModel: process.env.STELLE_SECONDARY_MODEL || SECONDARY_GEMINI_MODEL,
    ttsModel: process.env.STELLE_TTS_MODEL || GEMINI_TTS_MODEL,
  };
}

export function normalizeGeminiBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
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
