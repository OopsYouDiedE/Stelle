import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import type {
  AudioEngine,
  AudioInputRequest,
  AudioInputResult,
  AudioOutputRequest,
  AudioOutputResult,
} from "./types.js";

const DEFAULT_STT_MODEL = "gpt-4o-mini-transcribe";
const DEFAULT_TTS_MODEL = "kokoro";
const DEFAULT_TTS_VOICE = "af_heart";

function now(): number {
  return Date.now();
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export class ConfiguredAudioEngine implements AudioEngine {
  private readonly openai = new OpenAI({
    apiKey: env("OPENAI_API_KEY") ?? env("AISTUDIO_API_KEY") ?? "missing",
    baseURL: env("OPENAI_BASE_URL"),
  });

  async transcribe(request: AudioInputRequest): Promise<AudioInputResult> {
    const model = env("AUDIO_STT_MODEL") ?? DEFAULT_STT_MODEL;
    try {
      const result = await this.openai.audio.transcriptions.create({
        file: createReadStream(request.audio.path) as any,
        model,
        language: request.language,
        prompt: request.prompt,
        response_format: "json",
      });
      const text = String((result as { text?: unknown }).text ?? "");
      return {
        requestId: request.id,
        ok: true,
        text,
        language: request.language,
        durationMs: request.audio.durationMs,
        summary: text
          ? `Transcribed audio input ${request.id}: ${text.slice(0, 160)}`
          : `Transcribed audio input ${request.id}.`,
        timestamp: now(),
      };
    } catch (error) {
      return {
        requestId: request.id,
        ok: false,
        text: "",
        language: request.language,
        durationMs: request.audio.durationMs,
        summary: `Audio STT failed with ${model}: ${(error as Error).message}`,
        timestamp: now(),
      };
    }
  }

  async synthesize(request: AudioOutputRequest): Promise<AudioOutputResult> {
    const baseUrl = env("KOKORO_TTS_BASE_URL") ?? env("AUDIO_TTS_BASE_URL");
    const model = env("KOKORO_TTS_MODEL") ?? env("AUDIO_TTS_MODEL") ?? DEFAULT_TTS_MODEL;
    const voice = request.voice ?? env("KOKORO_TTS_VOICE") ?? env("AUDIO_TTS_VOICE") ?? DEFAULT_TTS_VOICE;
    const endpoint = `${baseUrl?.replace(/\/+$/, "") ?? ""}/v1/audio/speech`;

    if (!baseUrl) {
      return {
        requestId: request.id,
        ok: false,
        audioPath: null,
        summary:
          "Audio TTS is not configured. Set KOKORO_TTS_BASE_URL to an OpenAI-compatible Kokoro-82M speech endpoint.",
        timestamp: now(),
      };
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(env("KOKORO_TTS_API_KEY") || env("AUDIO_TTS_API_KEY")
            ? {
                Authorization: `Bearer ${env("KOKORO_TTS_API_KEY") ?? env("AUDIO_TTS_API_KEY")}`,
              }
            : {}),
        },
        body: JSON.stringify({
          model,
          input: request.text,
          voice,
          speed: request.speed,
          response_format: "wav",
        }),
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
      }

      const audioPath = await writeAudioArtifact(
        request.id,
        Buffer.from(await response.arrayBuffer())
      );
      return {
        requestId: request.id,
        ok: true,
        audioPath,
        summary: `Synthesized audio output ${request.id} with ${model}/${voice}.`,
        timestamp: now(),
      };
    } catch (error) {
      return {
        requestId: request.id,
        ok: false,
        audioPath: null,
        summary: `Audio TTS failed with ${model}/${voice}: ${(error as Error).message}`,
        timestamp: now(),
      };
    }
  }
}

export const configuredAudioEngine = new ConfiguredAudioEngine();

async function writeAudioArtifact(requestId: string, data: Buffer): Promise<string> {
  const dir = path.resolve(process.cwd(), "artifacts", "audio");
  await mkdir(dir, { recursive: true });
  const safeId = requestId.replace(/[<>:"/\\|?*]+/g, "_");
  const filePath = path.join(dir, `${safeId}-${Date.now()}.wav`);
  await writeFile(filePath, data);
  return filePath;
}
