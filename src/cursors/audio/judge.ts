import type {
  SpeechActivation,
  SpeechActivationJudgeResult,
  SpeechJudgeInput,
  SpeechTaskJudgeResult,
} from "./types.js";

export function judgeSpeechActivation(
  input: SpeechJudgeInput & { activation: SpeechActivation }
): SpeechActivationJudgeResult {
  const activation = input.activation;

  switch (activation.type) {
    case "audio_input_ready":
      return {
        accepted: true,
        queue: "transcription",
        reason: "Audio input should be queued for transcription.",
      };
    case "speak_requested":
      return {
        accepted: true,
        queue: "synthesis",
        reason: "Speech output should be queued for synthesis.",
      };
    case "playback_finished":
      return {
        accepted: true,
        reason: "Playback finished event updates speech state without queueing work.",
      };
    default:
      return {
        accepted: false,
        reason: `Speech cursor ignores activation ${activation.type}.`,
      };
  }
}

export function judgeSpeechNextTask(input: SpeechJudgeInput): SpeechTaskJudgeResult {
  if (input.context.pendingTranscriptions.length) {
    return {
      mode: "transcribe",
      reason: "Pending transcriptions take priority so incoming audio can be understood quickly.",
    };
  }

  if (input.context.pendingSyntheses.length) {
    return {
      mode: "synthesize",
      reason: "No transcription is pending, so queued speech can be synthesized.",
    };
  }

  return {
    mode: "idle",
    reason: "No queued speech work is pending.",
  };
}
