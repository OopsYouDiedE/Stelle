import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import mime from "mime";
import { loadStelleModelConfig, type StelleModelConfig } from "../config/StelleConfig.js";
import type { StreamingTtsProvider, TtsStreamArtifact, TtsSynthesisOptions } from "./types.js";

export interface GeminiTtsProviderOptions {
  config?: StelleModelConfig;
  ai?: GoogleGenAI;
  voiceName?: string;
  outputDir?: string;
}

interface WavConversionOptions {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

export class GeminiTtsProvider implements StreamingTtsProvider {
  readonly config: StelleModelConfig;
  private readonly ai: GoogleGenAI;
  private readonly voiceName: string;
  private readonly outputDir: string;

  constructor(options: GeminiTtsProviderOptions = {}) {
    this.config = options.config ?? loadStelleModelConfig();
    this.ai = options.ai ?? this.createClient();
    this.voiceName = options.voiceName ?? process.env.GEMINI_TTS_VOICE ?? "Zephyr";
    this.outputDir = options.outputDir ?? "artifacts/tts";
  }

  async synthesizeToFiles(text: string, options?: TtsSynthesisOptions): Promise<TtsStreamArtifact[]> {
    return this.synthesizeTextStream(single(text), options);
  }

  async synthesizeTextStream(
    chunks: AsyncIterable<string>,
    options?: TtsSynthesisOptions
  ): Promise<TtsStreamArtifact[]> {
    if (!this.config.apiKey) throw new Error("Missing Gemini API key.");
    const artifacts: TtsStreamArtifact[] = [];
    let index = 0;
    for await (const text of chunks) {
      const trimmed = text.trim();
      if (!trimmed) continue;
      const generated = await this.generateAudio(trimmed, options?.voiceName);
      for (const item of generated) {
        const fileIndex = index++;
        const artifact = await this.writeAudio(item.data, item.mimeType, trimmed, fileIndex, {
          outputDir: options?.outputDir,
          filePrefix: options?.filePrefix,
        });
        artifacts.push(artifact);
      }
    }
    return artifacts;
  }

  private async generateAudio(text: string, voiceName?: string): Promise<{ data: string; mimeType: string }[]> {
    const response = await this.ai.models.generateContentStream({
      model: this.config.ttsModel,
      config: {
        temperature: 1,
        responseModalities: ["audio"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceName ?? this.voiceName,
            },
          },
        },
      },
      contents: [{ role: "user", parts: [{ text: `## Transcript:\n${text}` }] }],
    });
    const audio: { data: string; mimeType: string }[] = [];
    for await (const chunk of response) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        const inlineData = part.inlineData;
        if (inlineData?.data) {
          audio.push({ data: inlineData.data, mimeType: inlineData.mimeType ?? "" });
        }
      }
    }
    return audio;
  }

  private async writeAudio(
    rawData: string,
    mimeType: string,
    text: string,
    index: number,
    options?: { outputDir?: string; filePrefix?: string }
  ): Promise<TtsStreamArtifact> {
    const outputDir = path.resolve(options?.outputDir ?? this.outputDir);
    await fs.mkdir(outputDir, { recursive: true });
    let extension = mime.getExtension(mimeType || "");
    let buffer: Buffer<ArrayBufferLike> = Buffer.from(rawData, "base64");
    if (!extension) {
      extension = "wav";
      buffer = convertToWav(rawData, mimeType);
    }
    const filePrefix = options?.filePrefix ?? "gemini-tts";
    const filePath = path.join(outputDir, `${filePrefix}-${String(index).padStart(3, "0")}.${extension}`);
    await fs.writeFile(filePath, buffer);
    return {
      index,
      path: filePath,
      mimeType: mimeType || `audio/${extension}`,
      byteLength: buffer.byteLength,
      text,
    };
  }

  private createClient(): GoogleGenAI {
    return new GoogleGenAI({
      apiKey: this.config.apiKey,
      httpOptions: {
        apiVersion: "v1beta",
        ...(this.config.baseUrl ? { baseUrl: this.config.baseUrl } : {}),
      },
    });
  }
}

async function* single(text: string): AsyncIterable<string> {
  yield text;
}

function convertToWav(rawData: string, mimeType: string): Buffer<ArrayBufferLike> {
  const options = parseMimeType(mimeType);
  const buffer = Buffer.from(rawData, "base64");
  const wavHeader = createWavHeader(buffer.byteLength, options);
  return Buffer.concat([wavHeader, buffer]);
}

function parseMimeType(mimeType: string): WavConversionOptions {
  const [fileType, ...params] = mimeType.split(";").map((item) => item.trim());
  const [, format] = (fileType ?? "").split("/");
  const options: Partial<WavConversionOptions> = {
    numChannels: 1,
    sampleRate: 24000,
    bitsPerSample: 16,
  };
  if (format?.startsWith("L")) {
    const bits = Number.parseInt(format.slice(1), 10);
    if (!Number.isNaN(bits)) options.bitsPerSample = bits;
  }
  for (const param of params) {
    const [key, value] = param.split("=").map((item) => item.trim());
    if (key === "rate") {
      const sampleRate = Number.parseInt(value, 10);
      if (!Number.isNaN(sampleRate)) options.sampleRate = sampleRate;
    }
  }
  return options as WavConversionOptions;
}

function createWavHeader(dataLength: number, options: WavConversionOptions): Buffer<ArrayBufferLike> {
  const { numChannels, sampleRate, bitsPerSample } = options;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const buffer = Buffer.alloc(44);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}
