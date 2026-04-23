import type { ToolDefinition } from "../types.js";
import { KokoroTtsProvider } from "../tts/KokoroTtsProvider.js";
import type { StreamingTtsProvider } from "../tts/types.js";
import { sanitizeExternalText } from "../text/sanitize.js";

export function createTtsTools(provider: StreamingTtsProvider = new KokoroTtsProvider()): ToolDefinition[] {
  const streamSpeechTool: ToolDefinition<{ text?: string; chunks?: string[]; output_dir?: string; file_prefix?: string; voice_name?: string; speed?: number; language?: string; stream?: boolean }> = {
    identity: {
      namespace: "tts",
      name: "kokoro_stream_speech",
      authorityClass: "stelle",
      version: "0.1.0",
    },
    description: {
      summary: "Streams text chunks into local Kokoro TTS and writes audio artifacts.",
      whenToUse: "Use when Live or Discord needs speech generated from streamed text output.",
      whenNotToUse: "Do not use for speech recognition; STT is intentionally out of scope for this prototype.",
    },
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Single text block to synthesize." },
        chunks: { type: "array", description: "Ordered text chunks to synthesize as a stream." },
        output_dir: { type: "string", description: "Output directory for audio artifacts." },
        file_prefix: { type: "string", description: "File name prefix." },
        voice_name: { type: "string", description: "Kokoro voice name. Defaults to KOKORO_TTS_VOICE or af_heart." },
        speed: { type: "number", description: "Optional Kokoro speech speed." },
        language: { type: "string", description: "Optional language hint for Kokoro-compatible servers." },
        stream: { type: "boolean", description: "True to consume Kokoro's streaming response while writing the artifact." },
      },
    },
    sideEffects: {
      externalVisible: false,
      writesFileSystem: true,
      networkAccess: true,
      startsProcess: false,
      changesConfig: false,
      consumesBudget: true,
      affectsUserState: false,
    },
    authority: {
      level: "local_write",
      scopes: ["tts.kokoro", "artifacts/tts"],
      requiresUserConfirmation: false,
    },
    async execute(input) {
      const chunks = Array.isArray(input.chunks)
        ? input.chunks.map(sanitizeExternalText)
        : typeof input.text === "string"
          ? [sanitizeExternalText(input.text)]
          : [];
      const visibleChunks = chunks.map((chunk) => chunk.trim()).filter(Boolean);
      if (!visibleChunks.length) {
        return {
          ok: false,
          summary: "No text or chunks were provided for Kokoro TTS.",
          error: { code: "invalid_input", message: "No text or chunks were provided for Kokoro TTS.", retryable: false },
        };
      }
      const artifacts = await provider.synthesizeTextStream(toAsync(visibleChunks), {
        outputDir: input.output_dir,
        filePrefix: input.file_prefix,
        voiceName: input.voice_name,
        speed: input.speed,
        language: input.language,
        stream: input.stream,
      });
      return {
        ok: true,
        summary: `Kokoro TTS wrote ${artifacts.length} audio artifact(s).`,
        data: { artifacts },
        sideEffects: artifacts.map((artifact) => ({
          type: "tts_audio_artifact",
          summary: `Wrote ${artifact.path}.`,
          visible: false,
          timestamp: Date.now(),
        })),
      };
    },
  };

  return [streamSpeechTool];
}

async function* toAsync(items: string[]): AsyncIterable<string> {
  for (const item of items) yield item;
}
