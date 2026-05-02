import type { PerceptualEvent } from "../../../core/protocol/perceptual_event.js";

export function eventText(event: PerceptualEvent): string {
  const payload = event.payload as { text?: unknown; summary?: unknown; message?: { content?: unknown } };
  return String(payload?.text ?? payload?.summary ?? payload?.message?.content ?? "").trim();
}

export function isHighPriority(event: PerceptualEvent): boolean {
  const payload = event.payload as Record<string, unknown>;
  const trust = payload?.trust as Record<string, unknown> | undefined;
  return Boolean(
    event.metadata?.priority === "high" ||
    payload?.priority === "high" ||
    payload?.kind === "gift" ||
    payload?.kind === "super_chat" ||
    trust?.paid === true,
  );
}
