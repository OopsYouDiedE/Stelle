import type { CursorRegistry } from "../CoreMind.js";
import { LiveCursor } from "../cursors/LiveCursor.js";
import type { Live2DMotionPriority, LiveActionResult } from "../live/LiveRuntime.js";
import { sanitizeExternalText } from "../TextStream.js";
import { KokoroTtsProvider, type StreamingTtsProvider, type TtsPlaybackResult, type TtsStreamArtifact } from "../KokoroTtsProvider.js";
import type { ToolDefinition, ToolResult } from "../types.js";

export interface LiveCursorToolsOptions {
  ttsProvider?: StreamingTtsProvider;
}

export function createLiveCursorTools(
  cursors: CursorRegistry,
  options: LiveCursorToolsOptions = {}
): ToolDefinition[] {
  return [
    ...createLiveStatusTools(cursors),
    ...createLiveStageTools(cursors),
    ...createObsTools(cursors),
    ...createLiveSpeechTools(cursors, options),
  ];
}

function createLiveStatusTools(cursors: CursorRegistry): ToolDefinition[] {
  const statusTool: ToolDefinition = {
    identity: { namespace: "live", name: "cursor_status", authorityClass: "cursor", version: "0.1.0" },
    description: {
      summary: "Reads Live Cursor stage and OBS status.",
      whenToUse: "Use to inspect the local Live2D/OBS host state.",
    },
    inputSchema: { type: "object", properties: {} },
    sideEffects: readOnlySideEffects(true),
    authority: { level: "read", scopes: ["live"], requiresUserConfirmation: false },
    async execute(_input, context) {
      const cursor = getLiveCursor(cursors, context.cursorId);
      if (!isLiveCursor(cursor)) return cursor;
      const status = await cursor.live.getStatus();
      return {
        ok: true,
        summary: `Live status: active=${status.active}, model=${status.stage.model?.id ?? "none"}, obsStreaming=${status.obs.streaming}`,
        data: { status },
      };
    },
  };

  const getStageTool: ToolDefinition = {
    identity: { namespace: "live", name: "cursor_get_stage", authorityClass: "cursor", version: "0.1.0" },
    description: {
      summary: "Reads current Live2D stage state.",
      whenToUse: "Use when a Cursor needs to inspect model, motion, caption, or interaction state.",
    },
    inputSchema: { type: "object", properties: {} },
    sideEffects: readOnlySideEffects(false),
    authority: { level: "read", scopes: ["live.stage"], requiresUserConfirmation: false },
    async execute(_input, context) {
      const cursor = getLiveCursor(cursors, context.cursorId);
      if (!isLiveCursor(cursor)) return cursor;
      const status = await cursor.live.getStatus();
      return {
        ok: true,
        summary: `Read Live2D stage for ${status.stage.model?.id ?? "none"}.`,
        data: { stage: status.stage },
      };
    },
  };

  const captionPreviewTool: ToolDefinition<{ text: string }> = {
    identity: { namespace: "live", name: "cursor_set_caption_preview", authorityClass: "cursor", version: "0.1.0" },
    description: {
      summary: "Updates the Live Cursor caption preview state.",
      whenToUse: "Use for local caption staging before a Stelle-level broadcast action.",
      whenNotToUse: "Do not treat this as a confirmed external broadcast action.",
    },
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Caption text." } },
      required: ["text"],
    },
    sideEffects: { ...readOnlySideEffects(false), affectsUserState: true },
    authority: { level: "local_write", scopes: ["live.caption.preview"], requiresUserConfirmation: false },
    async execute(input, context) {
      const cursor = getLiveCursor(cursors, context.cursorId);
      if (!isLiveCursor(cursor)) return cursor;
      const result = await cursor.live.setCaption(sanitizeExternalText(input.text));
      return {
        ...resultToToolResult(result),
        sideEffects: [
          {
            type: "live_caption_preview",
            summary: "Updated Live Cursor caption preview.",
            visible: false,
            timestamp: Date.now(),
          },
        ],
      };
    },
  };

  return [statusTool, getStageTool, captionPreviewTool];
}

const STAGE_SIDE_EFFECTS = {
  externalVisible: true,
  writesFileSystem: false,
  networkAccess: false,
  startsProcess: false,
  changesConfig: false,
  consumesBudget: false,
  affectsUserState: true,
} as const;

async function executeLiveStageAction<TInput>(
  cursors: CursorRegistry,
  context: { cursorId?: string },
  input: TInput,
  action: (cursor: LiveCursor, input: TInput) => Promise<ToolResult>
): Promise<ToolResult> {
  const cursor = getLiveCursor(cursors, context.cursorId);
  if (!isLiveCursor(cursor)) return cursor;
  return action(cursor, input);
}

function createLiveStageTools(cursors: CursorRegistry): ToolDefinition[] {
  const loadModelTool: ToolDefinition<{ model_id: string }> = {
    identity: { namespace: "live", name: "stelle_load_model", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Loads a registered Live2D model into the Live Cursor runtime.",
      whenToUse: "Use when Core Mind should switch the visible Live2D model.",
    },
    inputSchema: {
      type: "object",
      properties: { model_id: { type: "string", description: "Registered model id, e.g. Hiyori or Hiyori_pro." } },
      required: ["model_id"],
    },
    sideEffects: STAGE_SIDE_EFFECTS,
    authority: { level: "external_write", scopes: ["live2d.stage"], requiresUserConfirmation: false },
    async execute(input, context) {
      return executeLiveStageAction(cursors, context, input, async (cursor, currentInput) => ({
        ...resultToToolResult(await cursor.live.loadModel(currentInput.model_id)),
        sideEffects: [{ type: "live2d_model_change", summary: `Loaded ${currentInput.model_id}.`, visible: true, timestamp: Date.now() }],
      }));
    },
  };

  const motionTool: ToolDefinition<{ group: string; priority?: Live2DMotionPriority }> = {
    identity: { namespace: "live", name: "stelle_trigger_motion", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Triggers a Live2D motion group.",
      whenToUse: "Use when Stelle should make the Live2D model react visibly.",
    },
    inputSchema: {
      type: "object",
      properties: {
        group: { type: "string", description: "Motion group, e.g. Tap, Flick, Idle." },
        priority: { type: "string", description: "idle, normal, or force." },
      },
      required: ["group"],
    },
    sideEffects: STAGE_SIDE_EFFECTS,
    authority: { level: "external_write", scopes: ["live2d.motion"], requiresUserConfirmation: false },
    async execute(input, context) {
      return executeLiveStageAction(cursors, context, input, async (cursor, currentInput) => {
        const result = await cursor.live.triggerMotion(currentInput.group, currentInput.priority ?? "normal");
        return {
          ...resultToToolResult(result),
          sideEffects: [{ type: "live2d_motion", summary: result.summary, visible: true, timestamp: Date.now() }],
        };
      });
    },
  };

  const expressionTool: ToolDefinition<{ expression: string }> = {
    identity: { namespace: "live", name: "stelle_set_expression", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Sets a Live2D expression name in the runtime state.",
      whenToUse: "Use when Stelle should alter the model expression.",
    },
    inputSchema: {
      type: "object",
      properties: { expression: { type: "string", description: "Expression identifier." } },
      required: ["expression"],
    },
    sideEffects: STAGE_SIDE_EFFECTS,
    authority: { level: "external_write", scopes: ["live2d.expression"], requiresUserConfirmation: false },
    async execute(input, context) {
      return executeLiveStageAction(
        cursors,
        context,
        input,
        async (cursor, currentInput) => resultToToolResult(await cursor.live.setExpression(currentInput.expression))
      );
    },
  };

  const captionTool: ToolDefinition<{ text: string }> = {
    identity: { namespace: "live", name: "stelle_set_caption", authorityClass: "stelle", version: "0.1.0" },
    description: { summary: "Sets the live caption text.", whenToUse: "Use when Stelle should show a caption in the live host." },
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Caption text." } },
      required: ["text"],
    },
    sideEffects: STAGE_SIDE_EFFECTS,
    authority: { level: "external_write", scopes: ["live.caption"], requiresUserConfirmation: false },
    async execute(input, context) {
      return executeLiveStageAction(cursors, context, input, async (cursor, currentInput) => {
        const result = await cursor.live.setCaption(sanitizeExternalText(currentInput.text));
        return {
          ...resultToToolResult(result),
          sideEffects: [{ type: "live_caption", summary: result.summary, visible: true, timestamp: Date.now() }],
        };
      });
    },
  };

  const backgroundTool: ToolDefinition<{ source: string }> = {
    identity: { namespace: "live", name: "stelle_set_background", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Sets the live renderer background image, URL, file path, data URL, or CSS background.",
      whenToUse: "Use when Stelle should change the OBS live background behind the Live2D model.",
    },
    inputSchema: {
      type: "object",
      properties: { source: { type: "string", description: "Background URL/path/data URL/CSS background." } },
      required: ["source"],
    },
    sideEffects: STAGE_SIDE_EFFECTS,
    authority: { level: "external_write", scopes: ["live.background"], requiresUserConfirmation: false },
    async execute(input, context) {
      return executeLiveStageAction(cursors, context, input, async (cursor, currentInput) => {
        const result = await cursor.live.setBackground(currentInput.source);
        return {
          ...resultToToolResult(result),
          sideEffects: [{ type: "live_background", summary: result.summary, visible: true, timestamp: Date.now() }],
        };
      });
    },
  };

  return [loadModelTool, motionTool, expressionTool, captionTool, backgroundTool];
}

function obsSideEffects() {
  return {
    externalVisible: true,
    writesFileSystem: false,
    networkAccess: true,
    startsProcess: false,
    changesConfig: false,
    consumesBudget: false,
    affectsUserState: true,
  };
}

function createObsTools(cursors: CursorRegistry): ToolDefinition[] {
  const obsStatusTool: ToolDefinition = {
    identity: { namespace: "live", name: "obs_get_status", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Reads OBS WebSocket streaming and scene status.",
      whenToUse: "Use before starting/stopping stream or changing scene.",
    },
    inputSchema: { type: "object", properties: {} },
    sideEffects: readOnlySideEffects(true),
    authority: { level: "read", scopes: ["obs"], requiresUserConfirmation: false },
    async execute(_input, context) {
      const cursor = getLiveCursor(cursors, context.cursorId);
      if (!isLiveCursor(cursor)) return cursor;
      const status = await cursor.live.obs.getStatus();
      return {
        ok: true,
        summary: `OBS status: enabled=${status.enabled}, connected=${status.connected}, streaming=${status.streaming}`,
        data: { status },
      };
    },
  };

  const obsStartTool: ToolDefinition = {
    identity: { namespace: "live", name: "obs_start_stream", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Starts OBS streaming through OBS WebSocket.",
      whenToUse: "Use when Stelle should begin stream output from OBS.",
    },
    inputSchema: { type: "object", properties: {} },
    sideEffects: obsSideEffects(),
    authority: { level: "external_write", scopes: ["obs.stream"], requiresUserConfirmation: false },
    async execute(_input, context) {
      const cursor = getLiveCursor(cursors, context.cursorId);
      if (!isLiveCursor(cursor)) return cursor;
      const result = await cursor.live.obs.startStream();
      return {
        ...resultToToolResult(result),
        sideEffects: [{ type: "obs_stream_start", summary: result.summary, visible: true, timestamp: Date.now() }],
      };
    },
  };

  const obsStopTool: ToolDefinition = {
    identity: { namespace: "live", name: "obs_stop_stream", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Stops OBS streaming through OBS WebSocket.",
      whenToUse: "Use when Stelle should end stream output from OBS.",
    },
    inputSchema: { type: "object", properties: {} },
    sideEffects: obsSideEffects(),
    authority: { level: "external_write", scopes: ["obs.stream"], requiresUserConfirmation: false },
    async execute(_input, context) {
      const cursor = getLiveCursor(cursors, context.cursorId);
      if (!isLiveCursor(cursor)) return cursor;
      const result = await cursor.live.obs.stopStream();
      return {
        ...resultToToolResult(result),
        sideEffects: [{ type: "obs_stream_stop", summary: result.summary, visible: true, timestamp: Date.now() }],
      };
    },
  };

  const obsSceneTool: ToolDefinition<{ scene_name: string }> = {
    identity: { namespace: "live", name: "obs_set_scene", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Switches the current OBS program scene.",
      whenToUse: "Use when Stelle should switch stream layout or scene.",
    },
    inputSchema: {
      type: "object",
      properties: { scene_name: { type: "string", description: "OBS scene name." } },
      required: ["scene_name"],
    },
    sideEffects: obsSideEffects(),
    authority: { level: "external_write", scopes: ["obs.scene"], requiresUserConfirmation: false },
    async execute(input, context) {
      const cursor = getLiveCursor(cursors, context.cursorId);
      if (!isLiveCursor(cursor)) return cursor;
      const result = await cursor.live.obs.setCurrentScene(input.scene_name);
      return {
        ...resultToToolResult(result),
        sideEffects: [{ type: "obs_scene_change", summary: result.summary, visible: true, timestamp: Date.now() }],
      };
    },
  };

  return [obsStatusTool, obsStartTool, obsStopTool, obsSceneTool];
}

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

function createLiveSpeechTools(
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

function getLiveCursor(cursors: CursorRegistry, cursorId?: string): LiveCursor | ToolResult {
  if (cursorId) {
    const cursor = cursors.get(cursorId);
    if (cursor instanceof LiveCursor) return cursor;
  }
  const fallback = cursors.list().find((cursor) => cursor instanceof LiveCursor);
  if (fallback instanceof LiveCursor) return fallback;
  return {
    ok: false,
    summary: cursorId
      ? `Cursor ${cursorId} is not a Live Cursor and no Live Cursor is registered.`
      : "Missing cursorId and no Live Cursor is registered.",
    error: {
      code: "live_cursor_missing",
      message: cursorId
        ? `Cursor ${cursorId} is not a Live Cursor and no Live Cursor is registered.`
        : "Missing cursorId and no Live Cursor is registered.",
      retryable: false,
    },
  };
}

function isLiveCursor(cursor: LiveCursor | ToolResult): cursor is LiveCursor {
  return cursor instanceof LiveCursor;
}

function resultToToolResult(result: LiveActionResult): ToolResult {
  return {
    ok: result.ok,
    summary: result.summary,
    data: { result },
    error: result.error,
  };
}

function estimateSpeechDurationMs(text: string): number {
  const cjkChars = Array.from(text).filter((char) => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(char)).length;
  const latinWords = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  return Math.max(1200, Math.min(20000, Math.round(cjkChars * 220 + latinWords * 360)));
}

function liveTtsOutputMode(): "python-device" | "browser" | "artifact" {
  const value = (process.env.LIVE_TTS_OUTPUT ?? process.env.LIVE_AUDIO_OUTPUT ?? "browser").toLowerCase();
  if (value === "browser" || value === "artifact") return value;
  return "python-device";
}

function splitLiveSpeech(text: string): string[] {
  return text
    .split(/(?<=[\u3002\uff01\uff1f.!?])\s*|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function artifactPathToRendererUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const marker = "/artifacts/";
  const index = normalized.lastIndexOf(marker);
  if (index >= 0) return normalized.slice(index);
  if (normalized.startsWith("artifacts/")) return `/${normalized}`;
  return `/artifacts/tts/${normalized.split("/").pop()}`;
}

function readOnlySideEffects(networkAccess: boolean) {
  return {
    externalVisible: false,
    writesFileSystem: false,
    networkAccess,
    startsProcess: false,
    changesConfig: false,
    consumesBudget: false,
    affectsUserState: false,
  };
}
