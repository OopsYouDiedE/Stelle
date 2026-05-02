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

// === Imports ===
// Standard library or external dependencies.

// === Types & Interfaces ===
// Shared types for text processing.

// === Core Logic ===

const INTERNAL_TAGS = ["thought", "thinking", "analysis", "reasoning", "scratchpad", "chain_of_thought"];
const TAG_REGEX = new RegExp(`<\\s*\\/?\\s*(?:${INTERNAL_TAGS.join("|")})\\b[^>]*>`, "gi");
const CONTENT_REGEX = new RegExp(
  `<\\s*(${INTERNAL_TAGS.join("|")})\\b[^>]*>[\\s\\S]*?(?:<\\s*\\/\\s*\\1\\s*>|$)`,
  "gi",
);

const SENTENCE_END = /[\u3002\uff01\uff1f.!?\n]\s*/u;

/**
 * 清洗对外显示的文本内容
 */
export function sanitizeExternalText(value: unknown): string {
  return sanitizeExternalTextChunk(value).trim();
}

/**
 * 清洗文本片段 (不 trim)
 */
export function sanitizeExternalTextChunk(value: unknown): string {
  let text = String(value ?? "");

  // 1. 移除带内容的完整标签块或未闭合块
  text = text.replace(CONTENT_REGEX, "");

  // 2. 移除残余的孤立标签
  text = text.replace(TAG_REGEX, "");

  // 3. 空白字符规范化
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * 截断文本
 */
export function truncateText(text: string, maxChars: number): string {
  const clean = sanitizeExternalText(text);
  const chars = Array.from(clean);
  if (chars.length <= maxChars) return clean;
  return `${chars.slice(0, Math.max(0, maxChars - 3)).join("")}...`;
}

export function truncateUtf8Bytes(text: string, maxBytes: number): string {
  const clean = sanitizeExternalText(text);
  if (Buffer.byteLength(clean, "utf8") <= maxBytes) return clean;
  let result = "";
  for (const char of clean) {
    const next = result + char;
    if (Buffer.byteLength(next, "utf8") > maxBytes) break;
    result = next;
  }
  return result;
}

export function sanitizeTemplateValue(
  value: unknown,
  options: { maxCodePoints?: number; maxUtf8Bytes?: number } = {},
): string {
  let text = sanitizeExternalText(value).replace(/\s+/g, " ");
  if (options.maxCodePoints !== undefined) {
    text = Array.from(text).slice(0, Math.max(0, options.maxCodePoints)).join("");
  }
  if (options.maxUtf8Bytes !== undefined) {
    text = truncateUtf8Bytes(text, options.maxUtf8Bytes);
  }
  return text;
}

/**
 * 将文本切分为句子
 */
export function splitSentences(text: string, maxItems = 12): string[] {
  return sanitizeExternalText(text)
    .split(/(?<=[\u3002\uff01\uff1f.!?])\s*|\n+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

/**
 * 格式化时间
 */
export function formatClockMinute(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * 流式分句器
 */
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

/**
 * 将异步迭代流转化为分句流
 */
export async function* sentenceChunksFromStream(
  chunks: AsyncIterable<string>,
  options?: { maxChars?: number; minCharsBeforePunctuation?: number },
): AsyncIterable<string> {
  const chunker = new SentenceChunker(options);
  for await (const chunk of chunks) {
    for (const ready of chunker.push(chunk)) yield ready;
  }
  const tail = chunker.flush();
  if (tail) yield tail;
}

// === Helpers ===
// Internal utilities for text processing.
