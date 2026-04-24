import type { CursorRegistry } from "../../core/CursorRegistry.js";
import { KokoroTtsProvider } from "../../tts/KokoroTtsProvider.js";
import type { StreamingTtsProvider, TtsPlaybackResult, TtsStreamArtifact } from "../../tts/types.js";
import { sanitizeExternalText } from "../../text/sanitize.js";
import type { ToolDefinition } from "../../types.js";
import {
  artifactPathToRendererUrl,
  estimateSpeechDurationMs,
  getLiveCursor,
  isLiveCursor,
  liveTtsOutputMode,
  splitLiveSpeech,
} from "./shared.js";

const LIVE_TTS_SIDE_EFFECTS = {
  externalVisible: true,
  writesFileSystem: true,
  networkAccess: true,
  startsProcess: false,
  changesConfig: false,
  consumesBudget: true,
  affectsUserState: true,
} as const;

const LIVE_QUEUE_SIDE_EFFECTS = {
  externalVisible: false,
  writesFileSystem: false,
  networkAccess: false,
  startsProcess: false,
  changesConfig: false,
  consumesBudget: false,
  affectsUserState: true,
} as const;

function chunkListFromInput(input: { text?: string; chunks?: string[] }, splitText = false): string[] {
  if (Array.isArray(input.chunks)) return input.chunks.map(sanitizeExternalText);
  if (typeof input.text !== "string") return [];
  const text = sanitizeExternalText(input.text);
  return splitText ? splitLiveSpeech(text) : [text];
}

export function createLiveSpeechTools(
  cursors: CursorRegistry,
  options: { ttsProvider?: StreamingTtsProvider } = {}
): ToolDefinition[] {
  const liveTtsStreamTool: ToolDefinition<{
    text?: string;
    chunks?: string[];
    output_dir?: string;
    file_prefix?: string;
    voice_name?: string;
    speed?: number;
    language?: string;
    stream?: boolean;
  }> = {
    identity: { namespace: "live", name: "stelle_stream_tts_caption", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Streams text chunks into the Live caption state and Kokoro TTS artifacts.",
      whenToUse: "Use when a live route has streamed text output that should become captions and speech.",
    },
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Single text block." },
        chunks: { type: "array", description: "Ordered text chunks." },
        output_dir: { type: "string", description: "Output directory for audio artifacts." },
        file_prefix: { type: "string", description: "File name prefix." },
        voice_name: { type: "string", description: "Kokoro voice name." },
        speed: { type: "number", description: "Optional Kokoro speech speed." },
        language: { type: "string", description: "Optional language hint for Kokoro-compatible servers." },
        stream: { type: "boolean", description: "True to stream Kokoro audio directly through the live renderer. Defaults to true." },
      },
    },
    sideEffects: LIVE_TTS_SIDE_EFFECTS,
    authority: { level: "external_write", scopes: ["live.caption", "tts.kokoro", "artifacts/tts"], requiresUserConfirmation: false },
    async execute(input, context) {
      const cursor = getLiveCursor(cursors, context.cursorId);
      if (!isLiveCursor(cursor)) return cursor;

      const visibleChunks = chunkListFromInput(input).map((chunk) => chunk.trim()).filter(Boolean);
      if (!visibleChunks.length) {
        return {
          ok: false,
          summary: "No text or chunks were provided for live TTS caption streaming.",
          error: { code: "invalid_input", message: "No text or chunks were provided.", retryable: false },
        };
      }

      let caption = "";
      const tts = options.ttsProvider ?? new KokoroTtsProvider();
      const artifacts: TtsStreamArtifact[] = [];
      const playbackResults: TtsPlaybackResult[] = [];
      const outputMode = liveTtsOutputMode();
      const usePythonDeviceOutput = outputMode === "python-device" && Boolean(tts.playToDevice);
      const useLiveAudioStream =
        !usePythonDeviceOutput && input.stream !== false && !options.ttsProvider && process.env.LIVE_TTS_STREAMING !== "false";

      for (let index = 0; index < visibleChunks.length; index += 1) {
        const chunk = visibleChunks[index]!;
        caption += chunk;
        await cursor.live.setCaption(caption);

        if (usePythonDeviceOutput && tts.playToDevice) {
          await cursor.live.startSpeech(estimateSpeechDurationMs(chunk));
          try {
            playbackResults.push(
              await tts.playToDevice(chunk, {
                voiceName: input.voice_name,
                speed: input.speed,
                language: input.language,
                outputDevice: process.env.KOKORO_AUDIO_DEVICE,
              })
            );
          } finally {
            await cursor.live.stopSpeech();
          }
          continue;
        }

        if (useLiveAudioStream) {
          await cursor.live.playTtsStream(chunk, {
            voiceName: input.voice_name,
            speed: input.speed,
            language: input.language,
          });
          continue;
        }

        await cursor.live.startSpeech(estimateSpeechDurationMs(chunk));
        const chunkArtifacts = await tts.synthesizeToFiles(chunk, {
          outputDir: input.output_dir,
          filePrefix: `${input.file_prefix ?? "live-tts"}-${String(index).padStart(3, "0")}`,
          voiceName: input.voice_name,
          speed: input.speed,
          language: input.language,
          stream: input.stream,
        });
        for (const artifact of chunkArtifacts) {
          artifacts.push(artifact);
          await cursor.live.playAudio(artifactPathToRendererUrl(artifact.path), artifact.text);
        }
      }

      return {
        ok: true,
        summary: usePythonDeviceOutput
          ? `Streamed ${visibleChunks.length} caption chunk(s) and played Kokoro audio through the Python output device.`
          : useLiveAudioStream
            ? `Streamed ${visibleChunks.length} caption chunk(s) and queued Kokoro live audio stream playback.`
            : `Streamed ${visibleChunks.length} caption chunk(s), wrote ${artifacts.length} TTS artifact(s), and queued live audio playback.`,
        data: { chunks: visibleChunks, artifacts, playbackResults, caption, streamingAudio: useLiveAudioStream, outputMode },
        sideEffects: [
          { type: "live_caption", summary: "Updated Live Cursor caption from streamed text.", visible: true, timestamp: Date.now() },
          ...artifacts.map((artifact) => ({
            type: "tts_audio_artifact",
            summary: `Wrote ${artifact.path}.`,
            visible: false,
            timestamp: Date.now(),
          })),
        ],
      };
    },
  };

  const enqueueSpeechTool: ToolDefinition<{ text?: string; chunks?: string[]; source?: string }> = {
    identity: { namespace: "live", name: "stelle_enqueue_speech", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Queues live speech/caption chunks so the Live Cursor can play them gradually on ticks.",
      whenToUse: "Use when Stelle should preload talking points for the live stage instead of replacing the caption all at once.",
      whenNotToUse: "Do not use for urgent one-shot captions; use stelle_set_caption or stelle_stream_tts_caption instead.",
    },
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Single text block to split into queue items." },
        chunks: { type: "array", description: "Ordered text chunks." },
        source: { type: "string", description: "Queue source label." },
      },
    },
    sideEffects: LIVE_QUEUE_SIDE_EFFECTS,
    authority: { level: "local_write", scopes: ["live.speech_queue"], requiresUserConfirmation: false },
    async execute(input, context) {
      const cursor = getLiveCursor(cursors, context.cursorId);
      if (!isLiveCursor(cursor)) return cursor;
      const report = cursor.enqueueSpeech(
        chunkListFromInput(input, true).filter(Boolean),
        input.source ? String(input.source) : "stelle"
      );
      return {
        ok: true,
        summary: report.summary,
        data: { report, queue: cursor.getSpeechQueue() },
        sideEffects: [{ type: "live_speech_queue", summary: report.summary, visible: false, timestamp: Date.now() }],
      };
    },
  };

  return [liveTtsStreamTool, enqueueSpeechTool];
}
