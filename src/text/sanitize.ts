const INTERNAL_TAGS = ["thought", "thinking", "analysis", "reasoning", "scratchpad", "chain_of_thought"];

export function sanitizeExternalText(value: unknown): string {
  return sanitizeExternalTextRaw(value).trim();
}

export function sanitizeExternalTextChunk(value: unknown): string {
  return sanitizeExternalTextRaw(value);
}

function sanitizeExternalTextRaw(value: unknown): string {
  let text = String(value ?? "");
  for (const tag of INTERNAL_TAGS) {
    const closedBlock = new RegExp(`<\\s*${tag}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${tag}\\s*>`, "gi");
    text = text.replace(closedBlock, "");
    const danglingBlock = new RegExp(`<\\s*${tag}\\b[^>]*>[\\s\\S]*$`, "gi");
    text = text.replace(danglingBlock, "");
  }
  text = text
    .replace(/<\s*\/?\s*(?:thought|thinking|analysis|reasoning|scratchpad|chain_of_thought)\b[^>]*>/gi, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return text;
}

export function sanitizeExternalTextOrFallback(value: unknown, fallback: string): string {
  return sanitizeExternalText(value) || fallback;
}
