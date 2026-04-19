import type { CursorActivation, CursorHost, CursorReport } from "../base.js";

export type SpeechCursorStatus =
  | "idle"
  | "listening"
  | "transcribing"
  | "speaking"
  | "error";

export interface AudioChunkRef {
  path: string;
  mimeType?: string;
  durationMs?: number;
  source?: string;
}

export interface SpeechTranscriptionRequest {
  id: string;
  audio: AudioChunkRef;
  language?: string;
  prompt?: string;
  createdAt: number;
  source?: string;
}

export interface SpeechSynthesisRequest {
  id: string;
  text: string;
  voice?: string;
  style?: string;
  speed?: number;
  createdAt: number;
  source?: string;
}

export interface SpeechTranscriptionResult {
  requestId: string;
  ok: boolean;
  text: string;
  language?: string;
  durationMs?: number;
  summary: string;
  timestamp: number;
}

export interface SpeechSynthesisResult {
  requestId: string;
  ok: boolean;
  audioPath: string | null;
  durationMs?: number;
  summary: string;
  timestamp: number;
}

export interface SpeechEngine {
  transcribe(
    request: SpeechTranscriptionRequest
  ): Promise<SpeechTranscriptionResult>;
  synthesize(
    request: SpeechSynthesisRequest
  ): Promise<SpeechSynthesisResult>;
}

export type SpeechActivation =
  | (CursorActivation & {
      type: "audio_input_ready";
      payload: { request: SpeechTranscriptionRequest };
    })
  | (CursorActivation & {
      type: "speak_requested";
      payload: { request: SpeechSynthesisRequest };
    })
  | (CursorActivation & {
      type: "playback_finished";
      payload?: { requestId?: string };
    })
  | CursorActivation;

export interface SpeechCursorContext {
  queuedActivations: SpeechActivation[];
  pendingTranscriptions: SpeechTranscriptionRequest[];
  pendingSyntheses: SpeechSynthesisRequest[];
  recentReports: CursorReport[];
  lastActivationAt: number | null;
  lastProcessedAt: number | null;
  lastTranscript: SpeechTranscriptionResult | null;
  lastSynthesis: SpeechSynthesisResult | null;
}

export interface SpeechSnapshot {
  cursorId: string;
  kind: "speech";
  status: SpeechCursorStatus;
  queueLength: number;
  pendingTranscriptions: number;
  pendingSyntheses: number;
  lastActivationAt: number | null;
  lastProcessedAt: number | null;
  lastTranscriptText: string | null;
  lastSynthesisPath: string | null;
}

export interface SpeechCursor extends CursorHost {
  kind: "speech";
  submitTranscription(
    request: SpeechTranscriptionRequest
  ): Promise<SpeechTranscriptionResult>;
  submitSynthesis(
    request: SpeechSynthesisRequest
  ): Promise<SpeechSynthesisResult>;
  snapshot(): Promise<SpeechSnapshot>;
}
