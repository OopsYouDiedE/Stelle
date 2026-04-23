import { sanitizeExternalText, sanitizeExternalTextChunk } from "./sanitize.js";

export interface TextStreamDelta {
  type: "delta";
  index: number;
  text: string;
  timestamp: number;
}

export interface TextStreamDone {
  type: "done";
  index: number;
  text: string;
  timestamp: number;
}

export type TextStreamEvent = TextStreamDelta | TextStreamDone;

export interface SentenceChunkerOptions {
  maxChars?: number;
  minCharsBeforePunctuation?: number;
}

const SENTENCE_END = /[\u3002\uff01\uff1f.!?\n]\s*/u;

export async function* textEventsFromChunks(chunks: AsyncIterable<string>): AsyncIterable<TextStreamEvent> {
  let index = 0;
  let text = "";
  for await (const raw of chunks) {
    const chunk = sanitizeExternalTextChunk(raw);
    if (!chunk) continue;
    text += chunk;
    yield {
      type: "delta",
      index: index++,
      text: chunk,
      timestamp: Date.now(),
    };
  }
  yield {
    type: "done",
    index,
    text: sanitizeExternalText(text),
    timestamp: Date.now(),
  };
}

export async function collectTextStream(chunks: AsyncIterable<string>): Promise<string> {
  const parts: string[] = [];
  for await (const chunk of chunks) parts.push(chunk);
  return sanitizeExternalText(parts.join(""));
}

export async function* sentenceChunksFromTextStream(
  chunks: AsyncIterable<string>,
  options: SentenceChunkerOptions = {}
): AsyncIterable<string> {
  const chunker = new SentenceChunker(options);
  for await (const chunk of chunks) {
    for (const ready of chunker.push(chunk)) yield ready;
  }
  const tail = chunker.flush();
  if (tail) yield tail;
}

export class SentenceChunker {
  private buffer = "";
  private readonly maxChars: number;
  private readonly minCharsBeforePunctuation: number;

  constructor(options: SentenceChunkerOptions = {}) {
    this.maxChars = options.maxChars ?? 48;
    this.minCharsBeforePunctuation = options.minCharsBeforePunctuation ?? 4;
  }

  push(raw: string): string[] {
    this.buffer += sanitizeExternalTextChunk(raw);
    return this.takeReady();
  }

  flush(): string {
    const tail = sanitizeExternalText(this.buffer);
    this.buffer = "";
    return tail;
  }

  private takeReady(): string[] {
    const chunks: string[] = [];
    while (this.buffer.length) {
      const punctuation = SENTENCE_END.exec(this.buffer);
      if (punctuation && punctuation.index + punctuation[0].length >= this.minCharsBeforePunctuation) {
        const end = punctuation.index + punctuation[0].length;
        const chunk = sanitizeExternalText(this.buffer.slice(0, end));
        if (chunk) chunks.push(chunk);
        this.buffer = this.buffer.slice(end);
        continue;
      }
      const chars = Array.from(this.buffer);
      if (chars.length < this.maxChars) break;
      const chunk = sanitizeExternalText(chars.slice(0, this.maxChars).join(""));
      if (chunk) chunks.push(chunk);
      this.buffer = chars.slice(this.maxChars).join("");
    }
    return chunks;
  }
}
