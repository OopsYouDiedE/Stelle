import type { ToolDefinition } from "../../agent/types.js";
import { getAudioCursor } from "../../cursors/audio/index.js";

interface AudioTranscribeFileParams {
  path: string;
  language?: string;
  prompt?: string;
}

const audioTranscribeFileTool: ToolDefinition<AudioTranscribeFileParams> = {
  schema: {
    type: "function",
    function: {
      name: "audio_transcribe_file",
      description:
        "Transcribe a local audio file through the Audio Cursor using the configured STT model.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Local path to the audio file.",
          },
          language: {
            type: "string",
            description: "Optional language code, such as zh or en.",
          },
          prompt: {
            type: "string",
            description: "Optional transcription prompt or vocabulary hint.",
          },
        },
        required: ["path"],
      },
    },
  },
  async execute({ path, language, prompt }) {
    const cursor = getAudioCursor();
    await cursor.activate({
      type: "audio_input_ready",
      reason: "Tool requested audio transcription.",
      payload: {
        request: {
          id: `audio-input-${Date.now()}`,
          audio: { path, source: "tool" },
          language,
          prompt,
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

export default audioTranscribeFileTool;
