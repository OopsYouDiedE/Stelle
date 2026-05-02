import type { DebugProvider } from "../../../debug/contracts/debug_provider.js";
import type { StageDirector } from "./stage_director.js";

export function createStageDirectorDebugProvider(director: StageDirector): DebugProvider {
  return {
    id: "program.stage_director.debug",
    title: "Stage Director",
    ownerPackageId: "capability.program.stage_director",
    panels: [
      {
        id: "status",
        title: "Current Topic",
        kind: "json",
        getData: () => director.snapshot().topic,
      },
      {
        id: "widgets",
        title: "Widgets",
        kind: "json",
        getData: () => director.snapshot().widgets,
      },
    ],
    commands: [
      {
        id: "update_topic",
        title: "Update Topic",
        risk: "safe_write",
        run: (input: any) => director.orchestrator.updateTopic(input.title, input.question),
      },
    ],
    getSnapshot: () => director.snapshot(),
  };
}
