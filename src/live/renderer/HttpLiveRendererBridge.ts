import type { LiveRendererBridge, LiveRendererCommand } from "../types.js";

export class HttpLiveRendererBridge implements LiveRendererBridge {
  readonly url: string;
  lastError?: string;

  constructor(url = process.env.LIVE_RENDERER_URL ?? "") {
    this.url = url.replace(/\/+$/, "");
  }

  get enabled(): boolean {
    return Boolean(this.url);
  }

  async publish(command: LiveRendererCommand): Promise<void> {
    if (!this.enabled) return;
    try {
      const response = await fetch(`${this.url}/command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      });
      if (!response.ok) throw new Error(`Renderer command failed: ${response.status} ${response.statusText}`);
      this.lastError = undefined;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }
}
