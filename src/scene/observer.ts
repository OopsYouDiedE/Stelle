import type { LiveRendererServer } from "../utils/renderer.js";
import { truncateText } from "../utils/text.js";

export interface SceneObservationConfig {
  enabled: boolean;
}

export interface SceneObservation {
  source: "renderer" | "obs" | "unavailable";
  timestamp: number;
  visibleText: string[];
  sceneSummary: string;
  confidence: number;
  safetyNotes: string[];
}

export class SceneObserver {
  private renderer?: LiveRendererServer;

  constructor(
    private readonly config: SceneObservationConfig,
    renderer?: LiveRendererServer,
  ) {
    this.renderer = renderer;
  }

  setRenderer(renderer?: LiveRendererServer): void {
    this.renderer = renderer;
  }

  async observe(): Promise<SceneObservation> {
    if (!this.config.enabled) {
      return {
        source: "unavailable",
        timestamp: Date.now(),
        visibleText: [],
        sceneSummary: "Scene observation is disabled.",
        confidence: 0,
        safetyNotes: ["Enable sceneObservation.enabled before using read-only scene awareness."],
      };
    }

    const rendererStatus = this.renderer?.getStatus();
    if (rendererStatus) {
      const caption = typeof rendererStatus.state.caption === "string" ? rendererStatus.state.caption : "";
      const speaker = typeof rendererStatus.state.speaker === "string" ? rendererStatus.state.speaker : "";
      return {
        source: "renderer",
        timestamp: Date.now(),
        visibleText: [caption, speaker].filter(Boolean).map((item) => truncateText(item, 240)),
        sceneSummary: rendererStatus.connected
          ? `Renderer is connected with ${rendererStatus.socketCount} socket(s). Current caption: ${caption || "(none)"}.`
          : "Renderer server is not connected.",
        confidence: rendererStatus.connected ? 0.55 : 0.2,
        safetyNotes: ["Read-only renderer state observation; no desktop or OBS frame capture was performed."],
      };
    }

    return {
      source: "unavailable",
      timestamp: Date.now(),
      visibleText: [],
      sceneSummary: "No scene source is configured.",
      confidence: 0,
      safetyNotes: ["No renderer or OBS frame source is available."],
    };
  }
}
