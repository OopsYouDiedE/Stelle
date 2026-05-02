import type { DebugProvider } from "../../../debug/contracts/debug_provider.js";
import { StageOutputArbiter } from "./arbiter.js";

export function createStageOutputDebugProvider(arbiter: StageOutputArbiter): DebugProvider {
  return {
    id: "expression.stage_output.debug",
    title: "Stage Output",
    ownerPackageId: "capability.expression.stage_output",
    panels: [
      {
        id: "state",
        title: "Arbiter State",
        kind: "json",
        getData: () => (arbiter as any).state,
      },
      {
        id: "queue",
        title: "Output Queue",
        kind: "json",
        getData: () => {
          const queue = (arbiter as any).queue;
          return {
            items: queue.items,
            length: queue.items.length,
          };
        },
      },
      {
        id: "recent",
        title: "Recent Outputs",
        kind: "table",
        getData: () => (arbiter as any).recentOutputs,
      },
    ],
    commands: [
      {
        id: "clear_queue",
        title: "Clear Queue",
        risk: "safe_write",
        run: () => {
          (arbiter as any).queue.items.length = 0;
          return { status: "queue_cleared" };
        },
      },
      {
        id: "toggle_pause",
        title: "Toggle Auto-Reply",
        risk: "safe_write",
        run: () => {
          (arbiter as any).autoReplyPaused = !(arbiter as any).autoReplyPaused;
          return { paused: (arbiter as any).autoReplyPaused };
        },
      },
    ],
    getSnapshot: () => (arbiter as any).state,
  };
}
