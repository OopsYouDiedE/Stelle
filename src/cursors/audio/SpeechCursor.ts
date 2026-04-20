import type { CursorReport } from "../base.js";
import type {
  SpeechActivation,
  SpeechCursor,
  SpeechCursorContext,
  SpeechEngine,
  SpeechJudgeInput,
  SpeechSnapshot,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
  SpeechTranscriptionRequest,
  SpeechTranscriptionResult,
} from "./types.js";
import { judgeSpeechActivation, judgeSpeechNextTask } from "./judge.js";

function now(): number {
  return Date.now();
}

export interface SpeechCursorOptions {
  id?: string;
  engine: SpeechEngine;
}

export class EventDrivenSpeechCursor implements SpeechCursor {
  readonly id: string;
  readonly kind = "speech" as const;

  private readonly engine: SpeechEngine;
  private status: SpeechSnapshot["status"] = "idle";
  private readonly context: SpeechCursorContext = {
    queuedActivations: [],
    pendingTranscriptions: [],
    pendingSyntheses: [],
    recentReports: [],
    lastActivationAt: null,
    lastProcessedAt: null,
    lastTranscript: null,
    lastSynthesis: null,
  };

  constructor(options: SpeechCursorOptions) {
    this.id = options.id ?? "speech-main";
    this.engine = options.engine;
  }

  async activate(input: SpeechActivation): Promise<void> {
    this.context.queuedActivations.push(input);
    this.context.lastActivationAt = input.timestamp;
  }

  async tick(): Promise<CursorReport[]> {
    const reports: CursorReport[] = [];

    while (this.context.queuedActivations.length) {
      const activation = this.context.queuedActivations.shift()!;
      reports.push(...(await this.processActivation(activation)));
    }

    const nextTask = judgeSpeechNextTask(this.buildJudgeInput());
    reports.push(
      this.makeReport("status", `Speech judge: ${nextTask.reason}`, {
        mode: nextTask.mode,
      })
    );

    if (nextTask.mode === "transcribe" && this.context.pendingTranscriptions.length) {
      const next = this.context.pendingTranscriptions.shift()!;
      reports.push(await this.runTranscription(next));
    } else if (
      nextTask.mode === "synthesize" &&
      this.context.pendingSyntheses.length
    ) {
      const next = this.context.pendingSyntheses.shift()!;
      reports.push(await this.runSynthesis(next));
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

  async submitTranscription(
    request: SpeechTranscriptionRequest
  ): Promise<SpeechTranscriptionResult> {
    this.status = "transcribing";
    try {
      const result = await this.engine.transcribe(request);
      this.context.lastTranscript = result;
      this.status = "idle";
      return result;
    } catch (error) {
      this.status = "error";
      return {
        requestId: request.id,
        ok: false,
        text: "",
        summary: `Speech transcription failed: ${(error as Error).message}`,
        timestamp: now(),
      };
    }
  }

  async submitSynthesis(
    request: SpeechSynthesisRequest
  ): Promise<SpeechSynthesisResult> {
    this.status = "speaking";
    try {
      const result = await this.engine.synthesize(request);
      this.context.lastSynthesis = result;
      this.status = "idle";
      return result;
    } catch (error) {
      this.status = "error";
      return {
        requestId: request.id,
        ok: false,
        audioPath: null,
        summary: `Speech synthesis failed: ${(error as Error).message}`,
        timestamp: now(),
      };
    }
  }

  async snapshot(): Promise<SpeechSnapshot> {
    return {
      cursorId: this.id,
      kind: "speech",
      status: this.status,
      queueLength: this.context.queuedActivations.length,
      pendingTranscriptions: this.context.pendingTranscriptions.length,
      pendingSyntheses: this.context.pendingSyntheses.length,
      lastActivationAt: this.context.lastActivationAt,
      lastProcessedAt: this.context.lastProcessedAt,
      lastTranscriptText: this.context.lastTranscript?.text ?? null,
      lastSynthesisPath: this.context.lastSynthesis?.audioPath ?? null,
    };
  }

  private async processActivation(
    activation: SpeechActivation
  ): Promise<CursorReport[]> {
    const judge = judgeSpeechActivation({
      ...this.buildJudgeInput(),
      activation,
    });

    if (!judge.accepted) {
      return [
        this.makeReport("activation_ignored", `Speech judge rejected activation: ${judge.reason}`),
      ];
    }

    switch (activation.type) {
      case "audio_input_ready": {
        const request = (
          activation as Extract<
            SpeechActivation,
            { type: "audio_input_ready" }
          >
        ).payload.request;
        this.context.pendingTranscriptions.push(request);
        this.status = "listening";
        return [
          this.makeReport(
            "audio_input_queued",
            `Queued audio input ${request.id} for transcription.`,
            { requestId: request.id, judge: judge.reason }
          ),
        ];
      }
      case "speak_requested": {
        const request = (
          activation as Extract<
            SpeechActivation,
            { type: "speak_requested" }
          >
        ).payload.request;
        this.context.pendingSyntheses.push(request);
        this.status = "speaking";
        return [
          this.makeReport(
            "speech_output_queued",
            `Queued speech synthesis ${request.id}.`,
            { requestId: request.id, judge: judge.reason }
          ),
        ];
      }
      case "playback_finished":
        this.status = "idle";
        return [
          this.makeReport(
            "playback_finished",
            `Speech playback finished${activation.payload?.requestId ? ` for ${activation.payload.requestId}` : ""}.`,
            activation.payload
          ),
        ];
      default:
        return [
          this.makeReport(
            "activation_ignored",
            `Ignored speech activation ${activation.type}.`
          ),
        ];
    }
  }

  private async runTranscription(
    request: SpeechTranscriptionRequest
  ): Promise<CursorReport> {
    const result = await this.submitTranscription(request);
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

  private async runSynthesis(
    request: SpeechSynthesisRequest
  ): Promise<CursorReport> {
    const result = await this.submitSynthesis(request);
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

  private buildJudgeInput(): SpeechJudgeInput {
    return {
      context: {
        pendingTranscriptions: this.context.pendingTranscriptions,
        pendingSyntheses: this.context.pendingSyntheses,
        lastTranscript: this.context.lastTranscript,
        lastSynthesis: this.context.lastSynthesis,
      },
      status: this.status,
    };
  }
}
