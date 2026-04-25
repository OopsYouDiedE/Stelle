export interface StelleAudioState {
  queued: number;
  playing: boolean;
  playedCount: number;
  activated: boolean;
  lastUrl?: string;
  lastText?: string;
  lastEvent?: string;
  lastError?: string;
  errorName?: string;
  mediaErrorCode?: number;
  mediaErrorMessage?: string;
}

export interface AudioOwnershipRecord {
  id: string;
  timestamp: number;
  hidden: boolean;
}

export const SILENT_WAV_DATA_URL =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
export const STREAM_SAMPLE_RATE = 24000;
export const WAV_HEADER_BYTES = 44;
export const AUDIO_OWNER_KEY = "stelle-live-audio-owner";
export const AUDIO_OWNER_HEARTBEAT_MS = 1500;
export const AUDIO_OWNER_STALE_MS = 4500;

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function createAudioContext(): AudioContext | undefined {
  const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return undefined;
  return new AudioContextCtor({ sampleRate: STREAM_SAMPLE_RATE });
}

export function concatUint8(left: Uint8Array<ArrayBufferLike>, right: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
  const merged = new Uint8Array(left.byteLength + right.byteLength);
  merged.set(left, 0);
  merged.set(right, left.byteLength);
  return merged;
}

export function pcm16ToFloat32(bytes: Uint8Array<ArrayBufferLike>): Float32Array<ArrayBufferLike> {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const low = bytes[index * 2]!;
    const high = bytes[index * 2 + 1]!;
    let value = (high << 8) | low;
    if (value & 0x8000) value = value - 0x10000;
    samples[index] = value / 32768;
  }
  return samples;
}

export function readAudioOwnership(): AudioOwnershipRecord | null {
  try {
    const raw = localStorage.getItem(AUDIO_OWNER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: string; timestamp?: number; hidden?: boolean };
    if (!parsed.id || typeof parsed.timestamp !== "number") return null;
    return {
      id: parsed.id,
      timestamp: parsed.timestamp,
      hidden: parsed.hidden === true,
    };
  } catch {
    return null;
  }
}

export function writeAudioOwnership(value: AudioOwnershipRecord): void {
  try {
    localStorage.setItem(AUDIO_OWNER_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage failures and keep best-effort single-audio behavior.
  }
}
