import type { CursorReport } from "../base.js";
import type {
  AudioActivation,
  AudioCursor,
  AudioCursorContext,
  AudioEngine,
  AudioJudgeInput,
  AudioOutputRequest,
  AudioOutputResult,
  AudioSnapshot,
  AudioInputRequest,
  AudioInputResult,
} from "./types.js";
import { judgeAudioActivation, judgeAudioNextTask } from "./judge.js";

function now(): number {
  return Date.now();
}

export interface AudioCursorOptions {
  id?: string;
  engine: AudioEngine;
}

export class EventDrivenAudioCursor implements AudioCursor {
  readonly id: string;
  readonly kind = "audio" as const;

  private readonly engine: AudioEngine;
  private status: AudioSnapshot["status"] = "idle";
  private readonly context: AudioCursorContext = {
    queuedActivations: [],
    pendingInputs: [],
    pendingOutputs: [],
    recentReports: [],
    lastActivationAt: null,
    lastProcessedAt: null,
    lastInput: null,
    lastOutput: null,
  };

  constructor(options: AudioCursorOptions) {
    this.id = options.id ?? "audio-main";
    this.engine = options.engine;
  }

  async activate(input: AudioActivation): Promise<void> {
    this.context.queuedActivations.push(input);
    this.context.lastActivationAt = input.timestamp;
  }

  async tick(): Promise<CursorReport[]> {
    const reports: CursorReport[] = [];

    while (this.context.queuedActivations.length) {
      const activation = this.context.queuedActivations.shift()!;
      reports.push(...(await this.processActivation(activation)));
    }

    const nextTask = judgeAudioNextTask(this.buildJudgeInput());
    reports.push(
      this.makeReport("status", `Audio judge: ${nextTask.reason}`, {
        mode: nextTask.mode,
      })
    );

    if (nextTask.mode === "transcribe_input" && this.context.pendingInputs.length) {
      const next = this.context.pendingInputs.shift()!;
      reports.push(await this.runInput(next));
    } else if (
      nextTask.mode === "synthesize_output" &&
      this.context.pendingOutputs.length
    ) {
      const next = this.context.pendingOutputs.shift()!;
      reports.push(await this.runOutput(next));
    } else if (nextTask.mode === "idle") {
      this.status = "idle";
    }

    this.context.lastProcessedAt = now();
    for (const report of reports) {
      this.context.recentReports.push(report);
      if (this.context.recentReports.length > 50) {
        this.context.recentReports.shift();
      }
    }
    return reports;
  }

  async submitInput(
    request: AudioInputRequest
  ): Promise<AudioInputResult> {
    this.status = "transcribing";
    try {
      const result = await this.engine.transcribe(request);
      this.context.lastInput = result;
      this.status = "idle";
      return result;
    } catch (error) {
      this.status = "error";
      return {
        requestId: request.id,
        ok: false,
        text: "",
        summary: `Audio input transcription failed: ${(error as Error).message}`,
        timestamp: now(),
      };
    }
  }

  async submitOutput(
    request: AudioOutputRequest
  ): Promise<AudioOutputResult> {
    this.status = "speaking";
    try {
      const result = await this.engine.synthesize(request);
      this.context.lastOutput = result;
      this.status = "idle";
      return result;
    } catch (error) {
      this.status = "error";
      return {
        requestId: request.id,
        ok: false,
        audioPath: null,
        summary: `Audio output synthesis failed: ${(error as Error).message}`,
        timestamp: now(),
      };
    }
  }

  async snapshot(): Promise<AudioSnapshot> {
    return {
      cursorId: this.id,
      kind: "audio",
      status: this.status,
      queueLength: this.context.queuedActivations.length,
      pendingInputs: this.context.pendingInputs.length,
      pendingOutputs: this.context.pendingOutputs.length,
      lastActivationAt: this.context.lastActivationAt,
      lastProcessedAt: this.context.lastProcessedAt,
      lastInputText: this.context.lastInput?.text ?? null,
      lastOutputPath: this.context.lastOutput?.audioPath ?? null,
    };
  }

  private async processActivation(
    activation: AudioActivation
  ): Promise<CursorReport[]> {
    const judge = judgeAudioActivation({
      ...this.buildJudgeInput(),
      activation,
    });

    if (!judge.accepted) {
      return [
        this.makeReport("activation_ignored", `Audio judge rejected activation: ${judge.reason}`),
      ];
    }

    switch (activation.type) {
      case "audio_input_ready": {
        const request = (
          activation as Extract<
            AudioActivation,
            { type: "audio_input_ready" }
          >
        ).payload.request;
        this.context.pendingInputs.push(request);
        this.status = "listening";
        return [
          this.makeReport(
            "audio_input_queued",
            `Queued audio input ${request.id} for transcription.`,
            { requestId: request.id, judge: judge.reason }
          ),
        ];
      }
      case "audio_output_requested":
      case "speak_requested": {
        const request = (
          activation as Extract<
            AudioActivation,
            { type: "audio_output_requested" | "speak_requested" }
          >
        ).payload.request;
        this.context.pendingOutputs.push(request);
        this.status = "speaking";
        return [
          this.makeReport(
            "audio_output_queued",
            `Queued audio output synthesis ${request.id}.`,
            { requestId: request.id, judge: judge.reason }
          ),
        ];
      }
      case "playback_finished":
        this.status = "idle";
        return [
          this.makeReport(
            "playback_finished",
            `Audio playback finished${activation.payload?.requestId ? ` for ${activation.payload.requestId}` : ""}.`,
            activation.payload
          ),
        ];
      default:
        return [
          this.makeReport(
            "activation_ignored",
            `Ignored audio activation ${activation.type}.`
          ),
        ];
    }
  }

  private async runInput(
    request: AudioInputRequest
  ): Promise<CursorReport> {
    const result = await this.submitInput(request);
    return this.makeReport(
      result.ok ? "transcription_completed" : "transcription_failed",
      result.summary,
      {
        requestId: result.requestId,
        text: result.text,
        language: result.language,
      }
    );
  }

  private async runOutput(
    request: AudioOutputRequest
  ): Promise<CursorReport> {
    const result = await this.submitOutput(request);
    return this.makeReport(
      result.ok ? "synthesis_completed" : "synthesis_failed",
      result.summary,
      {
        requestId: result.requestId,
        audioPath: result.audioPath,
      }
    );
  }

  private makeReport(
    type: string,
    summary: string,
    payload?: Record<string, unknown>
  ): CursorReport {
    return {
      cursorId: this.id,
      type,
      summary,
      payload,
      timestamp: now(),
    };
  }

  async submitTranscription(
    request: AudioInputRequest
  ): Promise<AudioInputResult> {
    return this.submitInput(request);
  }

  async submitSynthesis(
    request: AudioOutputRequest
  ): Promise<AudioOutputResult> {
    return this.submitOutput(request);
  }

  private buildJudgeInput(): AudioJudgeInput {
    return {
      context: {
        pendingInputs: this.context.pendingInputs,
        pendingOutputs: this.context.pendingOutputs,
        lastInput: this.context.lastInput,
        lastOutput: this.context.lastOutput,
      },
      status: this.status,
    };
  }
}

export type SpeechCursorOptions = AudioCursorOptions;

export class EventDrivenSpeechCursor extends EventDrivenAudioCursor {}
