import type { DesktopInputObservation } from "./types.js";

export class DesktopInputObserver {
  normalize(payload: Record<string, unknown>): DesktopInputObservation {
    return {
      resourceId: String(payload.resourceId ?? payload.sessionId ?? "desktop"),
      activeWindow: payload.activeWindow ? String(payload.activeWindow) : undefined,
      screenSummary: payload.screenSummary ?? payload.summary ? String(payload.screenSummary ?? payload.summary) : undefined,
      requestedAction: typeof payload.requestedAction === "object" && payload.requestedAction
        ? payload.requestedAction as DesktopInputObservation["requestedAction"]
        : undefined,
      raw: payload,
    };
  }
}
