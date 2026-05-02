import { fetchLiveTtsAudio, normalizeTtsProvider, type TtsProviderName } from "../../utils/tts.js";

export interface RendererTtsEntry {
  provider: TtsProviderName;
  request: Record<string, unknown>;
  createdAt: number;
}

export class RendererTtsRequestStore {
  private readonly requests = new Map<string, RendererTtsEntry>();

  capture(command: { type: string; url?: unknown; request?: unknown }, now = Date.now()): void {
    if (command.type !== "audio:stream" || typeof command.url !== "string") return;
    const match = command.url.match(/^\/tts\/([^/?#]+)\/([^/?#]+)/);
    if (!match) return;
    const request = command.request;
    if (!request || typeof request !== "object" || Array.isArray(request)) return;

    this.requests.set(match[2]!, {
      provider: normalizeTtsProvider(match[1]!),
      request: request as Record<string, unknown>,
      createdAt: now,
    });
    this.prune(now);
  }

  get(id: string): RendererTtsEntry | undefined {
    return this.requests.get(id);
  }

  private prune(now: number): void {
    for (const [id, entry] of this.requests) {
      if (now - entry.createdAt > 5 * 60 * 1000) this.requests.delete(id);
    }
  }
}

export async function fetchRendererTtsAudio(entry: RendererTtsEntry): Promise<Response> {
  return fetchLiveTtsAudio(entry.provider, entry.request);
}
