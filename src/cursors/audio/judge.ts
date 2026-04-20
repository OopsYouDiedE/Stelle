import type {
  AudioActivation,
  AudioActivationJudgeResult,
  AudioJudgeInput,
  AudioTaskJudgeResult,
} from "./types.js";

export function judgeAudioActivation(
  input: AudioJudgeInput & { activation: AudioActivation }
): AudioActivationJudgeResult {
  const activation = input.activation;

  switch (activation.type) {
    case "audio_input_ready":
      return {
        accepted: true,
        queue: "input",
        reason: "Audio input should be queued for transcription.",
      };
    case "audio_output_requested":
    case "speak_requested":
      return {
        accepted: true,
        queue: "output",
        reason: "Audio output should be queued for synthesis.",
      };
    case "playback_finished":
      return {
        accepted: true,
        reason: "Playback finished event updates speech state without queueing work.",
      };
    default:
      return {
        accepted: false,
        reason: `Audio cursor ignores activation ${activation.type}.`,
      };
  }
}

export function judgeAudioNextTask(input: AudioJudgeInput): AudioTaskJudgeResult {
  if (input.context.pendingInputs.length) {
    return {
      mode: "transcribe_input",
      reason: "Pending audio inputs take priority so incoming speech can be understood quickly.",
    };
  }

  if (input.context.pendingOutputs.length) {
    return {
      mode: "synthesize_output",
      reason: "No audio input is pending, so queued speech output can be synthesized.",
    };
  }

  return {
    mode: "idle",
    reason: "No queued audio input or output work is pending.",
  };
}

export const judgeSpeechActivation = judgeAudioActivation;
export const judgeSpeechNextTask = judgeAudioNextTask;
