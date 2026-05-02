import type { DebugProvider } from "../../../core/protocol/debug.js";
import type { MemoryStore } from "./memory_store.js";

export function createMemoryStoreDebugProvider(store: MemoryStore): DebugProvider {
  return {
    id: "memory.store.debug",
    title: "Memory Store",
    ownerPackageId: "capability.memory.store",
    panels: [
      {
        id: "snapshot",
        title: "Memory Snapshot",
        kind: "json",
        getData: () => store.snapshot(),
      },
    ],
    commands: [
      {
        id: "propose",
        title: "Propose Manual Memory",
        risk: "safe_write",
        run: (input: any) => store.proposeMemory(input),
      },
    ],
    getSnapshot: () => store.snapshot(),
  };
}
