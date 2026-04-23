import type { CursorActivation, CursorHost, CursorReport } from "../base.js";

export type AudioCursorStatus =
  | "idle"
  | "listening"
  | "transcribing"
  | "speaking"
  | "error";

export interface AudioInputRef {
  path: string;
  mimeType?: string;
  durationMs?: number;
  source?: string;
}

export interface AudioInputRequest {
  id: string;
  audio: AudioInputRef;
  language?: string;
  prompt?: string;
  createdAt: number;
  source?: string;
}

export interface AudioOutputRequest {
  id: string;
  text: string;
  voice?: string;
  style?: string;
  speed?: number;
  createdAt: number;
  source?: string;
}

export interface AudioInputResult {
  requestId: string;
  ok: boolean;
  text: string;
  language?: string;
  durationMs?: number;
  summary: string;
  timestamp: number;
}

export interface AudioOutputResult {
  requestId: string;
  ok: boolean;
  audioPath: string | null;
  durationMs?: number;
  summary: string;
  timestamp: number;
}

export interface AudioEngine {
  transcribe(
    request: AudioInputRequest
  ): Promise<AudioInputResult>;
  synthesize(
    request: AudioOutputRequest
  ): Promise<AudioOutputResult>;
}

export type AudioActivation =
  | (CursorActivation & {
      type: "audio_input_ready";
      payload: { request: AudioInputRequest };
    })
  | (CursorActivation & {
      type: "audio_output_requested" | "speak_requested";
      payload: { request: AudioOutputRequest };
    })
  | (CursorActivation & {
      type: "playback_finished";
      payload?: { requestId?: string };
    })
  | CursorActivation;

export interface AudioCursorContext {
  queuedActivations: AudioActivation[];
  pendingInputs: AudioInputRequest[];
  pendingOutputs: AudioOutputRequest[];
  recentReports: CursorReport[];
  lastActivationAt: number | null;
  lastProcessedAt: number | null;
  lastInput: AudioInputResult | null;
  lastOutput: AudioOutputResult | null;
}

export interface AudioJudgeInput {
  context: Pick<
    AudioCursorContext,
    "pendingInputs" | "pendingOutputs" | "lastInput" | "lastOutput"
  >;
  activation?: AudioActivation;
  status: AudioCursorStatus;
}

export interface AudioActivationJudgeResult {
  accepted: boolean;
  queue?: "input" | "output";
  reason: string;
}

export interface AudioTaskJudgeResult {
  mode: "transcribe_input" | "synthesize_output" | "idle";
  reason: string;
}

export interface AudioSnapshot {
  cursorId: string;
  kind: "audio";
  status: AudioCursorStatus;
  queueLength: number;
  pendingInputs: number;
  pendingOutputs: number;
  lastActivationAt: number | null;
  lastProcessedAt: number | null;
  lastInputText: string | null;
  lastOutputPath: string | null;
}

export interface AudioCursor extends CursorHost {
  kind: "audio";
  submitInput(request: AudioInputRequest): Promise<AudioInputResult>;
  submitOutput(request: AudioOutputRequest): Promise<AudioOutputResult>;
  snapshot(): Promise<AudioSnapshot>;
}

export type AudioChunkRef = AudioInputRef;
export type SpeechCursorStatus = AudioCursorStatus;
export type SpeechTranscriptionRequest = AudioInputRequest;
export type SpeechSynthesisRequest = AudioOutputRequest;
export type SpeechTranscriptionResult = AudioInputResult;
export type SpeechSynthesisResult = AudioOutputResult;
export type SpeechEngine = AudioEngine;
export type SpeechActivation = AudioActivation;
export type SpeechCursorContext = AudioCursorContext;
export type SpeechJudgeInput = AudioJudgeInput;
export type SpeechActivationJudgeResult = AudioActivationJudgeResult;
export type SpeechTaskJudgeResult = AudioTaskJudgeResult;
export type SpeechSnapshot = AudioSnapshot;
export type SpeechCursor = AudioCursor;
