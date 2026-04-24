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

export interface StelleRuntimeConfig {
  channels?: Record<string, { activated?: boolean }>;
}

function firstDefined(...values: Array<string | undefined>): string {
  return values.find((value) => typeof value === "string" && value.length > 0) ?? "";
}

export function loadRawConfig(path = "config.yaml"): StelleRuntimeConfig {
  if (!fs.existsSync(path)) return {};
  return YAML.parse(fs.readFileSync(path, "utf8")) as StelleRuntimeConfig;
}

export function loadStelleModelConfig(path = "config.yaml"): StelleModelConfig {
  const apiKey = firstDefined(process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY, process.env.AISTUDIO_API_KEY);
  return {
    apiKey,
    baseUrl: normalizeGeminiBaseUrl(firstDefined(process.env.GEMINI_BASE_URL, process.env.AISTUDIO_BASE_URL)),
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
