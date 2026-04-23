export interface TtsStreamArtifact {
  index: number;
  path: string;
  mimeType: string;
  byteLength: number;
  text: string;
}

export interface TtsAudioStream {
  index: number;
  text: string;
  mimeType: string;
  chunks: AsyncIterable<Uint8Array>;
}

export interface TtsSynthesisOptions {
  outputDir?: string;
  filePrefix?: string;
  voiceName?: string;
  speed?: number;
  language?: string;
  stream?: boolean;
  outputDevice?: string | number;
}

export interface TtsPlaybackResult {
  status: string;
  engine: string;
  sampleRate: number;
  voice: string;
  language: string;
  textLength: number;
  device: string;
  frames: number;
  chunks: number;
  durationMs: number;
}

export interface StreamingTtsProvider {
  synthesizeToFiles(text: string, options?: TtsSynthesisOptions): Promise<TtsStreamArtifact[]>;
  synthesizeTextStream(chunks: AsyncIterable<string>, options?: TtsSynthesisOptions): Promise<TtsStreamArtifact[]>;
  streamAudio?(text: string, options?: TtsSynthesisOptions & { index?: number }): Promise<TtsAudioStream>;
  streamTextStream?(chunks: AsyncIterable<string>, options?: TtsSynthesisOptions): AsyncIterable<TtsAudioStream>;
  playToDevice?(text: string, options?: TtsSynthesisOptions): Promise<TtsPlaybackResult>;
}
