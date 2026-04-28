import type { CursorContext } from "../../types.js";
import { DeviceObservationCursor } from "../device_observation_cursor.js";
import { DesktopInputExecutor } from "./executor.js";
import { DesktopInputGateway } from "./gateway.js";
import { DesktopInputObserver } from "./observer.js";
import { DesktopInputResponder } from "./responder.js";
import { DesktopInputRouter } from "./router.js";
import type { DesktopInputObservation, DesktopInputRouteDecision } from "./types.js";

export class DesktopInputCursor extends DeviceObservationCursor<DesktopInputObservation, DesktopInputRouteDecision> {
  constructor(context: CursorContext) {
    super(context, {
      id: "desktop_input",
      kind: "device_desktop_input",
      displayName: "Desktop Input Cursor",
      eventType: "desktop.input.observation.received",
      logPrefix: "[DesktopInputCursor]",
      initialSummary: "Desktop Input Cursor is observing.",
      gateway: new DesktopInputGateway(),
      observer: new DesktopInputObserver(),
      router: new DesktopInputRouter(context, "desktop_input"),
      executor: new DesktopInputExecutor(context),
      responder: new DesktopInputResponder(),
    });
  }
}
