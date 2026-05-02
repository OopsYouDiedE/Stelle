import type { DebugProvider } from "../../debug/contracts/debug_provider.js";
import type { StageWindow } from "./stage_window.js";

export function createStageWindowDebugProvider(window: StageWindow): DebugProvider {
  return {
    id: "window.stage.debug",
    title: "Stage Window",
    ownerPackageId: "window.stage",
    panels: [{ id: "status", title: "Status", kind: "json", getData: () => window.snapshot() }],
    getSnapshot: () => window.snapshot(),
  };
}
