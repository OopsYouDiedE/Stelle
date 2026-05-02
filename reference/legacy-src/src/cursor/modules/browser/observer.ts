// === Imports ===
import type { BrowserObservation } from "./types.js";

// === Observer Implementation ===
export class BrowserObserver {
  normalize(payload: Record<string, unknown>): BrowserObservation {
    return {
      resourceId: String(payload.resourceId ?? payload.sessionId ?? "default"),
      url: payload.url ? String(payload.url) : undefined,
      title: payload.title ? String(payload.title) : undefined,
      summary: payload.summary ? String(payload.summary) : undefined,
      requestedAction:
        typeof payload.requestedAction === "object" && payload.requestedAction
          ? (payload.requestedAction as BrowserObservation["requestedAction"])
          : undefined,
      raw: payload,
    };
  }
}
