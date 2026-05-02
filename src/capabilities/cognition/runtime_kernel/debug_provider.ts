import type { DebugProvider } from "../../../core/protocol/debug.js";
import type { RuntimeKernel } from "./kernel.js";

export function createRuntimeKernelDebugProvider(kernel: RuntimeKernel): DebugProvider {
  return {
    id: "cognition.kernel.debug",
    title: "Runtime Kernel",
    ownerPackageId: "capability.cognition.runtime_kernel",
    panels: [
      {
        id: "state",
        title: "Kernel State",
        kind: "json",
        getData: () => kernel.snapshot().state,
      },
      {
        id: "last_decision",
        title: "Last Decision",
        kind: "json",
        getData: () => kernel.snapshot().lastDecision,
      },
    ],
    commands: [
      {
        id: "reset_state",
        title: "Reset Kernel State",
        risk: "safe_write",
        run: () => {
          // kernel.reset() logic
          return { status: "reset_requested" };
        },
      },
    ],
    getSnapshot: () => kernel.snapshot(),
  };
}
