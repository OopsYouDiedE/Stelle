import type { CursorRegistry } from "../../core/CursorRegistry.js";
import { LiveCursor } from "../../cursors/live/LiveCursor.js";
import type { LiveActionResult } from "../../live/types.js";
import type { ToolResult } from "../../types.js";

export interface LiveCursorToolsOptions {
  ttsProvider?: import("../../tts/types.js").StreamingTtsProvider;
}

export function getLiveCursor(cursors: CursorRegistry, cursorId?: string): LiveCursor | ToolResult {
  if (cursorId) {
    const cursor = cursors.get(cursorId);
    if (cursor instanceof LiveCursor) return cursor;
  }
  const fallback = cursors.list().find((cursor) => cursor instanceof LiveCursor);
  if (fallback instanceof LiveCursor) return fallback;
  return {
    ok: false,
    summary: cursorId
      ? `Cursor ${cursorId} is not a Live Cursor and no Live Cursor is registered.`
      : "Missing cursorId and no Live Cursor is registered.",
    error: {
      code: "live_cursor_missing",
      message: cursorId
        ? `Cursor ${cursorId} is not a Live Cursor and no Live Cursor is registered.`
        : "Missing cursorId and no Live Cursor is registered.",
      retryable: false,
    },
  };
}

export function isLiveCursor(cursor: LiveCursor | ToolResult): cursor is LiveCursor {
  return cursor instanceof LiveCursor;
}

export function resultToToolResult(result: LiveActionResult): ToolResult {
  return {
    ok: result.ok,
    summary: result.summary,
    data: { result },
    error: result.error,
  };
}

export function estimateSpeechDurationMs(text: string): number {
  const cjkChars = Array.from(text).filter((char) => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(char)).length;
  const latinWords = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  return Math.max(1200, Math.min(20000, Math.round(cjkChars * 220 + latinWords * 360)));
}

export function liveTtsOutputMode(): "python-device" | "browser" | "artifact" {
  const value = (process.env.LIVE_TTS_OUTPUT ?? process.env.LIVE_AUDIO_OUTPUT ?? "browser").toLowerCase();
  if (value === "browser" || value === "artifact") return value;
  return "python-device";
}

export function splitLiveSpeech(text: string): string[] {
  return text
    .split(/(?<=[\u3002\uff01\uff1f.!?])\s*|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function artifactPathToRendererUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const marker = "/artifacts/";
  const index = normalized.lastIndexOf(marker);
  if (index >= 0) return normalized.slice(index);
  if (normalized.startsWith("artifacts/")) return `/${normalized}`;
  return `/artifacts/tts/${normalized.split("/").pop()}`;
}

export function readOnlySideEffects(networkAccess: boolean) {
  return {
    externalVisible: false,
    writesFileSystem: false,
    networkAccess,
    startsProcess: false,
    changesConfig: false,
    consumesBudget: false,
    affectsUserState: false,
  };
}
