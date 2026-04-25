/**
 * 模块：文本清洗与切分
 *
 * 运行逻辑：
 * - 所有对外文本发送前都应经过 sanitize，移除内部标签、压缩空白。
 * - Cursor 和 TTS 复用 truncate/sentence split，保持输出长度可控。
 *
 * 主要方法：
 * - `sanitizeExternalText()`：发送到 Discord/直播前的最终清洗。
 * - `truncateText()`：按字符上限截断。
 * - `splitSentences()` / `SentenceChunker`：字幕/TTS 分句。
 */
const INTERNAL_TAGS = ["thought", "thinking", "analysis", "reasoning", "scratchpad", "chain_of_thought"];
const SENTENCE_END = /[\u3002\uff01\uff1f.!?\n]\s*/u;

export function sanitizeExternalText(value: unknown): string {
  return sanitizeExternalTextChunk(value).trim();
}

export function sanitizeExternalTextChunk(value: unknown): string {
  let text = String(value ?? "");
  for (const tag of INTERNAL_TAGS) {
    text = text.replace(new RegExp(`<\\s*${tag}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${tag}\\s*>`, "gi"), "");
    text = text.replace(new RegExp(`<\\s*${tag}\\b[^>]*>[\\s\\S]*$`, "gi"), "");
  }
  return text
    .replace(/<\s*\/?\s*(?:thought|thinking|analysis|reasoning|scratchpad|chain_of_thought)\b[^>]*>/gi, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function truncateText(text: string, maxChars: number): string {
  const clean = sanitizeExternalText(text);
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function splitSentences(text: string, maxItems = 12): string[] {
  return sanitizeExternalText(text)
    .split(/(?<=[\u3002\uff01\uff1f.!?])\s*|\n+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

export function formatClockMinute(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export class SentenceChunker {
  private buffer = "";

  constructor(private readonly options: { maxChars?: number; minCharsBeforePunctuation?: number } = {}) {}

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
    const maxChars = this.options.maxChars ?? 48;
    const minChars = this.options.minCharsBeforePunctuation ?? 4;
    const chunks: string[] = [];
    while (this.buffer.length) {
      const punctuation = SENTENCE_END.exec(this.buffer);
      if (punctuation && punctuation.index + punctuation[0].length >= minChars) {
        const end = punctuation.index + punctuation[0].length;
        const chunk = sanitizeExternalText(this.buffer.slice(0, end));
        if (chunk) chunks.push(chunk);
        this.buffer = this.buffer.slice(end);
        continue;
      }
      const chars = Array.from(this.buffer);
      if (chars.length < maxChars) break;
      const chunk = sanitizeExternalText(chars.slice(0, maxChars).join(""));
      if (chunk) chunks.push(chunk);
      this.buffer = chars.slice(maxChars).join("");
    }
    return chunks;
  }
}

export async function* sentenceChunksFromStream(
  chunks: AsyncIterable<string>,
  options?: { maxChars?: number; minCharsBeforePunctuation?: number }
): AsyncIterable<string> {
  const chunker = new SentenceChunker(options);
  for await (const chunk of chunks) {
    for (const ready of chunker.push(chunk)) yield ready;
  }
  const tail = chunker.flush();
  if (tail) yield tail;
}
