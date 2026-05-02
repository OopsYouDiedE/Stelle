import type { DebugProvider } from "../../core/protocol/debug.js";
import type { LiveWindow } from "./live_window.js";

export function createLiveWindowDebugProvider(window: LiveWindow): DebugProvider {
  return {
    id: "window.live.debug",
    title: "Live Window",
    ownerPackageId: "window.live",
    panels: [
      {
        id: "status",
        title: "Connection Status",
        kind: "json",
        getData: () => window.getStatus(),
      },
    ],
    commands: [
      {
        id: "reconnect_all",
        title: "Reconnect All Platforms",
        risk: "runtime_control",
        run: async () => {
          await window.stop();
          await window.start();
          return { status: "reconnect_triggered" };
        },
      },
    ],
    getSnapshot: () => window.getStatus(),
  };
}
