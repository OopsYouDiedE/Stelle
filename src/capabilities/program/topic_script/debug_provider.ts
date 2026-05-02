import type { DebugProvider } from "../../../core/protocol/debug.js";
import type { TopicScriptRuntimeService } from "./runtime.js";

export function createTopicScriptDebugProvider(service: TopicScriptRuntimeService): DebugProvider {
  return {
    id: "program.topic_script.debug",
    title: "Topic Script",
    ownerPackageId: "capability.program.topic_script",
    panels: [
      {
        id: "status",
        title: "Runtime Status",
        kind: "json",
        getData: () => service.snapshot(),
      },
    ],
    commands: [
      {
        id: "pause",
        title: "Pause Script",
        risk: "safe_write",
        run: () => service.pause(),
      },
      {
        id: "resume",
        title: "Resume Script",
        risk: "safe_write",
        run: () => service.resume(),
      },
      {
        id: "skip_section",
        title: "Skip Current Section",
        risk: "safe_write",
        run: () => service.skipSection("debug_skip"),
      },
    ],
    getSnapshot: () => service.snapshot(),
  };
}
