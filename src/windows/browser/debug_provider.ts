import type { DebugProvider } from "../../core/protocol/debug.js";
import type { BrowserWindow } from "./browser_window.js";

export function createBrowserWindowDebugProvider(window: BrowserWindow): DebugProvider {
  return {
    id: "window.browser.debug",
    title: "Browser Window",
    ownerPackageId: "window.browser",
    panels: [{ id: "status", title: "Status", kind: "json", getData: () => window.snapshot() }],
    getSnapshot: () => window.snapshot(),
  };
}
