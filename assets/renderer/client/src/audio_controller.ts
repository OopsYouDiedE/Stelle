import type { Live2DAvatar } from "./live2d";

export interface AudioSyncPayload {
  text?: string;
  speaker?: string;
  rateMs?: number;
}

export interface RendererAudioController {
  queueAudio(url: string, sync?: AudioSyncPayload): void;
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

  const queueAudio = (url: string, sync?: AudioSyncPayload): void => {
    if (!url) return;
    pendingAudioQueue.push({ url, ...sync });
    while (pendingAudioQueue.length > 3) pendingAudioQueue.shift();
    void pumpAudioQueue();
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
      await options.avatar?.startLipSync(audio);
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
          .then(() => {
            options.setAudioStatus("audio playing");
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
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      activeAudio = null;
    }
    options.avatar?.stopLipSync();
    options.setAudioStatus("audio stopped");
  };

  return { queueAudio, stopAudioPlayback };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
