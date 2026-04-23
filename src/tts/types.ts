export interface TtsStreamArtifact {
  index: number;
  path: string;
  mimeType: string;
  byteLength: number;
  text: string;
}

export interface TtsSynthesisOptions {
  outputDir?: string;
  filePrefix?: string;
  voiceName?: string;
  speed?: number;
  language?: string;
}

export interface StreamingTtsProvider {
  synthesizeToFiles(text: string, options?: TtsSynthesisOptions): Promise<TtsStreamArtifact[]>;
  synthesizeTextStream(chunks: AsyncIterable<string>, options?: TtsSynthesisOptions): Promise<TtsStreamArtifact[]>;
}
