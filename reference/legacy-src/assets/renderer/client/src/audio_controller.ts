import type { Live2DAvatar } from "./live2d";

export interface AudioSyncPayload {
  audioId?: string;
  text?: string;
  speaker?: string;
  rateMs?: number;
  durationHintMs?: number;
}

export interface RendererAudioController {
  queueAudio(url: string, sync?: AudioSyncPayload): void;
  startChunkStream(input: AudioSyncPayload & { streamId: string; sampleRate?: number; audioFormat?: string }): void;
  pushAudioChunk(input: { streamId: string; audioBase64: string; sampleRate?: number; audioFormat?: string }): void;
  endChunkStream(input: { streamId: string; chunks?: number; byteLength?: number }): void;
  stopAudioPlayback(): void;
}

export function createRendererAudioController(options: {
  avatar: Live2DAvatar | null;
  setCaption(text: string): void;
  setSpeaker(text: string): void;
  setAudioStatus(text: string): void;
  streamCaption(text: string, source: string, rateMs?: number): Promise<void>;
  cancelCaptionStream(): void;
}): RendererAudioController {
  let activeAudio: HTMLAudioElement | null = null;
  const pendingAudioQueue: Array<{ url: string } & AudioSyncPayload> = [];
  let audioPumpRunning = false;
  let audioContext: AudioContext | null = null;
  let activeChunkStream: {
    streamId: string;
    sampleRate: number;
    audioFormat: string;
    nextStartTime: number;
    sources: AudioBufferSourceNode[];
    receivedChunks: number;
    receivedBytes: number;
  } | null = null;

  const queueAudio = (url: string, sync?: AudioSyncPayload): void => {
    if (!url) return;
    pendingAudioQueue.push({ url, ...sync });
    while (pendingAudioQueue.length > 3) pendingAudioQueue.shift();
    void pumpAudioQueue();
  };

  const startChunkStream = (input: AudioSyncPayload & { streamId: string; sampleRate?: number; audioFormat?: string }): void => {
    stopChunkStream();
    if (input.text?.trim()) {
      options.cancelCaptionStream();
      options.setSpeaker(input.speaker ?? "Stelle");
      void options.streamCaption(input.text, input.speaker ?? "Stelle", input.rateMs);
    }
    const context = ensureAudioContext();
    activeChunkStream = {
      streamId: input.streamId,
      sampleRate: input.sampleRate || 24000,
      audioFormat: input.audioFormat || "pcm",
      nextStartTime: context.currentTime + 0.05,
      sources: [],
      receivedChunks: 0,
      receivedBytes: 0,
    };
    options.setAudioStatus("realtime audio streaming");
  };

  const pushAudioChunk = (input: { streamId: string; audioBase64: string; sampleRate?: number; audioFormat?: string }): void => {
    if (!input.audioBase64) return;
    if (!activeChunkStream || activeChunkStream.streamId !== input.streamId) {
      startChunkStream({ streamId: input.streamId, sampleRate: input.sampleRate, audioFormat: input.audioFormat });
    }
    if (!activeChunkStream) return;
    try {
      const bytes = base64ToUint8Array(input.audioBase64);
      activeChunkStream.receivedChunks += 1;
      activeChunkStream.receivedBytes += bytes.byteLength;
      if ((input.audioFormat || activeChunkStream.audioFormat) !== "pcm") {
        options.setAudioStatus(`unsupported realtime format ${input.audioFormat || activeChunkStream.audioFormat}`);
        return;
      }
      schedulePcmChunk(bytes, input.sampleRate || activeChunkStream.sampleRate);
      options.setAudioStatus(`realtime audio chunks ${activeChunkStream.receivedChunks}`);
    } catch (error) {
      options.setAudioStatus(`realtime audio error ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const endChunkStream = (input: { streamId: string; chunks?: number; byteLength?: number }): void => {
    if (!activeChunkStream || activeChunkStream.streamId !== input.streamId) return;
    const chunks = input.chunks ?? activeChunkStream.receivedChunks;
    options.setAudioStatus(chunks > 0 ? `realtime audio queued ${chunks}` : "realtime audio empty");
  };

  const pumpAudioQueue = async (): Promise<void> => {
    if (audioPumpRunning) return;
    audioPumpRunning = true;
    try {
      while (pendingAudioQueue.length > 0) {
        const next = pendingAudioQueue.shift();
        if (!next) continue;
        await playAudio(next);
      }
    } finally {
      audioPumpRunning = false;
    }
  };

  const playAudio = async (item: { url: string } & AudioSyncPayload): Promise<void> => {
    if (!item.url) return;
    const audio = new Audio(item.url);
    audio.autoplay = true;
    audio.preload = "auto";
    audio.playsInline = true;
    activeAudio = audio;
    try {
      options.setAudioStatus("audio loading");
      if (item.text?.trim()) {
        options.cancelCaptionStream();
        options.setSpeaker(item.speaker ?? "Stelle");
        options.setCaption(" ");
      }
      await new Promise<void>((resolve, reject) => {
        audio.addEventListener(
          "ended",
          () => {
            options.avatar?.stopLipSync();
            resolve();
          },
          { once: true },
        );
        audio.addEventListener(
          "pause",
          () => {
            options.avatar?.stopLipSync();
            resolve();
          },
          { once: true },
        );
        audio.addEventListener(
          "error",
          () => {
            console.warn("live audio element error", item.url);
            options.avatar?.stopLipSync();
            reject(new Error(`audio element error: ${item.url}`));
          },
          { once: true },
        );
        audio
          .play()
          .then(async () => {
            options.setAudioStatus("audio playing");
            await options.avatar?.startLipSync(audio);
            startSyncedCaption(item, audio);
            console.log("live audio playing", item.url);
          })
          .catch(reject);
      });
    } catch (error) {
      console.warn("live audio play failed", error);
      options.avatar?.stopLipSync();
    } finally {
      if (activeAudio === audio) activeAudio = null;
      options.setAudioStatus(pendingAudioQueue.length > 0 ? "audio queued" : "audio idle");
    }
  };

  const startSyncedCaption = (item: AudioSyncPayload, audio: HTMLAudioElement): void => {
    const text = item.text?.trim();
    if (!text) return;
    const chars = [...text].length || 1;
    const durationMs = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : undefined;
    const rateMs = durationMs ? clamp(Math.floor(durationMs / chars), 22, 90) : item.rateMs;
    void options.streamCaption(text, item.speaker ?? "Stelle", rateMs);
  };

  const stopAudioPlayback = (): void => {
    options.cancelCaptionStream();
    pendingAudioQueue.length = 0;
    stopChunkStream();
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      activeAudio = null;
    }
    options.avatar?.stopLipSync();
    options.setAudioStatus("audio stopped");
  };

  const ensureAudioContext = (): AudioContext => {
    const AudioContextCtor =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!audioContext) audioContext = new AudioContextCtor();
    void audioContext.resume().catch(() => undefined);
    return audioContext;
  };

  const schedulePcmChunk = (bytes: Uint8Array, sampleRate: number): void => {
    if (!activeChunkStream) return;
    const context = ensureAudioContext();
    const analyser = ensureChunkAnalyser(context);
    const samples = pcm16ToFloat32(bytes);
    if (!samples.length) return;
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    const startAt = Math.max(context.currentTime + 0.02, activeChunkStream.nextStartTime);
    source.start(startAt);
    activeChunkStream.nextStartTime = startAt + buffer.duration;
    activeChunkStream.sources.push(source);
    source.onended = () => {
      if (!activeChunkStream) return;
      activeChunkStream.sources = activeChunkStream.sources.filter((item) => item !== source);
      if (activeChunkStream.sources.length === 0) {
        options.avatar?.stopLipSync();
        options.setAudioStatus("audio idle");
      }
    };
    void options.avatar?.startLipSyncFromAnalyser(analyser);
  };

  const stopChunkStream = (): void => {
    if (!activeChunkStream) return;
    for (const source of activeChunkStream.sources) {
      try {
        source.stop();
      } catch {
        /* ignore */
      }
    }
    activeChunkStream = null;
    options.avatar?.stopLipSync();
  };

  return { queueAudio, startChunkStream, pushAudioChunk, endChunkStream, stopAudioPlayback };
}

function ensureChunkAnalyser(context: AudioContext): AnalyserNode {
  const anyContext = context as AudioContext & { __stelleChunkAnalyser?: AnalyserNode };
  if (!anyContext.__stelleChunkAnalyser) {
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.48;
    analyser.connect(context.destination);
    anyContext.__stelleChunkAnalyser = analyser;
  }
  return anyContext.__stelleChunkAnalyser;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function base64ToUint8Array(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = Math.max(-1, Math.min(1, view.getInt16(index * 2, true) / 32768));
  }
  return samples;
}
