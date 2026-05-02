import { rename, writeFile } from "node:fs/promises";
import { sanitizeExternalText } from "../../../utils/text.js";
import type { MemoryProposal, MemoryScope } from "./types.js";

export function safeSegment(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-") || "untitled";
}

export function parseJsonl<T>(raw: string): T[] {
  const entries: T[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as T);
    } catch {
      // Ignore corrupt lines.
    }
  }
  return entries;
}

export function defaultProposalTargetKey(proposal: MemoryProposal): string {
  if (proposal.layer === "user_facts") return `user_${safeSegment(proposal.authorId)}`;
  return "approved_proposals";
}

export function scopeLabel(scope: MemoryScope): string {
  if (scope.kind === "discord_channel") return `discord:${scope.channelId}`;
  if (scope.kind === "discord_global") return "discord:global";
  return scope.kind;
}

export function keywordSnippets(text: string): string[] {
  const clean = sanitizeExternalText(text).replace(/https?:\/\/\S+/g, " ");
  const matches = clean.match(/[\p{L}\p{N}]{2,12}/gu) || [];
  return matches.slice(0, 6);
}

export async function atomicWrite(file: string, content: string): Promise<void> {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, file);
}

export async function atomicAppend(file: string, content: string): Promise<void> {
  const { appendFile } = await import("node:fs/promises");
  await appendFile(file, content, "utf8");
}
