import type { CursorContext } from "../../types.js";
import { DeviceObservationCursor } from "../device_observation_cursor.js";
import { BrowserExecutor } from "./executor.js";
import { BrowserGateway } from "./gateway.js";
import { BrowserObserver } from "./observer.js";
import { BrowserResponder } from "./responder.js";
import { BrowserRouter } from "./router.js";
import type { BrowserObservation, BrowserRouteDecision } from "./types.js";

export class BrowserCursor extends DeviceObservationCursor<BrowserObservation, BrowserRouteDecision> {
  constructor(context: CursorContext) {
    super(context, {
      id: "browser",
      kind: "device_browser",
      displayName: "Browser Cursor",
      eventType: "browser.observation.received",
      logPrefix: "[BrowserCursor]",
      initialSummary: "Browser Cursor is observing.",
      gateway: new BrowserGateway(),
      observer: new BrowserObserver(),
      router: new BrowserRouter(context, "browser"),
      executor: new BrowserExecutor(context),
      responder: new BrowserResponder(),
    });
  }
}
