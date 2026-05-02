import type { DebugProvider } from "../../../debug/contracts/debug_provider.js";
import type { ReflectionEngine } from "./reflection_engine.js";

export function createReflectionDebugProvider(engine: ReflectionEngine): DebugProvider {
  return {
    id: "cognition.reflection.debug",
    title: "Reflection Engine",
    ownerPackageId: "capability.cognition.reflection",
    panels: [
      {
        id: "status",
        title: "Reflection Status",
        kind: "json",
        getData: () => engine.snapshot(),
      },
    ],
    commands: [
      {
        id: "trigger_reflection",
        title: "Trigger Background Reflection",
        risk: "runtime_control",
        run: () => engine.reflect("debug command"),
      },
    ],
    getSnapshot: () => engine.snapshot(),
  };
}
