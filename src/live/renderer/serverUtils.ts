import type { IncomingMessage } from "node:http";
import path from "node:path";
import type { Live2DStageState } from "../types.js";

export interface MockSpeechRequest {
  chunks?: string[];
  text?: string;
  intervalMs?: number;
  voice_name?: string;
  speed?: number;
  language?: string;
}

export const DEFAULT_MOCK_SPEECH_CHUNKS = [
  "晚上好，直播调试链路现在开始预热。",
  "这里是一段虚拟内容流，我们会把文本逐块送进 Kokoro。",
  "如果你现在能听到连续语音 chunk，说明浏览器自动播放和流式播放都已经打通。",
];

export function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".moc3") return "application/octet-stream";
  if (ext === ".wasm") return "application/wasm";
  return "application/octet-stream";
}

export function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

export function cloneState(state: Live2DStageState): Live2DStageState {
  return JSON.parse(JSON.stringify(state)) as Live2DStageState;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function parseJson(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function normalizeMockSpeechChunks(input: MockSpeechRequest): string[] {
  if (Array.isArray(input.chunks)) {
    return input.chunks.map((chunk) => String(chunk ?? "").trim()).filter(Boolean);
  }
  if (typeof input.text === "string" && input.text.trim()) {
    return input.text
      .split(/\r?\n+/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
  }
  return [...DEFAULT_MOCK_SPEECH_CHUNKS];
}

export function clampMockInterval(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1400;
  return Math.max(150, Math.min(10000, Math.round(value ?? 1400)));
}
