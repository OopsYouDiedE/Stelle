import type { DebugProvider } from "../../core/protocol/debug.js";
import type { DesktopInputWindow } from "./desktop_input_window.js";

export function createDesktopInputWindowDebugProvider(window: DesktopInputWindow): DebugProvider {
  return {
    id: "window.desktop_input.debug",
    title: "Desktop Input Window",
    ownerPackageId: "window.desktop_input",
    panels: [{ id: "status", title: "Status", kind: "json", getData: () => window.snapshot() }],
    getSnapshot: () => window.snapshot(),
  };
}
