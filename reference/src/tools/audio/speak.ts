import type { ToolDefinition } from "../../agent/types.js";
import { getAudioCursor } from "../../cursors/audio/index.js";

interface AudioSpeakParams {
  text: string;
  voice?: string;
  style?: string;
  speed?: number;
}

const audioSpeakTool: ToolDefinition<AudioSpeakParams> = {
  schema: {
    type: "function",
    function: {
      name: "audio_speak",
      description:
        "Synthesize speech through the Audio Cursor using the configured Kokoro/OpenAI-compatible TTS endpoint.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Text to synthesize.",
          },
          voice: {
            type: "string",
            description: "Optional voice name. Defaults to KOKORO_TTS_VOICE or af_heart.",
          },
          style: {
            type: "string",
            description: "Optional speaking style hint.",
          },
          speed: {
            type: "number",
            description: "Optional speech speed multiplier.",
          },
        },
        required: ["text"],
      },
    },
  },
  async execute({ text, voice, style, speed }) {
    const cursor = getAudioCursor();
    await cursor.activate({
      type: "audio_output_requested",
      reason: "Tool requested audio output.",
      payload: {
        request: {
          id: `audio-output-${Date.now()}`,
          text,
          voice,
          style,
          speed,
          createdAt: Date.now(),
          source: "tool",
        },
      },
      timestamp: Date.now(),
    });
    const reports = await cursor.tick();
    return JSON.stringify({ ok: true, reports, snapshot: await cursor.snapshot() }, null, 2);
  },
};

export default audioSpeakTool;
