import type { ContextStreamItem } from "../types.js";
import { sanitizeExternalText } from "../text/sanitize.js";

export function truncate(text: string, max: number): string {
  const trimmed = sanitizeExternalText(text).replace(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}...` : trimmed;
}

export function contextText(stream: ContextStreamItem[]): string {
  return stream
    .filter((item) => item.content)
    .map((item) => `[${item.type}:${item.source}] ${item.content}`)
    .join("\n")
    .slice(-8000);
}

export function splitLiveSpeech(text: string): string[] {
  return text
    .split(/(?<=[\u3002\uff01\uff1f.!?])\s*|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function estimateSpeechDurationMs(text: string): number {
  const cjkChars = Array.from(text).filter((char) => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(char)).length;
  const latinWords = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  return Math.max(1200, Math.min(20000, Math.round(cjkChars * 220 + latinWords * 360)));
}
