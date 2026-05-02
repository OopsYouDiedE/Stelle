import { describe, expect, it, vi } from "vitest";
import { ComponentLoader } from "../../src/core/runtime/component_loader.js";
import { ComponentRegistry } from "../../src/core/runtime/component_registry.js";
import { DataPlane } from "../../src/core/runtime/data_plane.js";
import type { ComponentPackage } from "../../src/core/protocol/component.js";
import { StelleEventBus } from "../../src/core/event/event_bus.js";

describe("Hotplug capability/window lifecycle", () => {
  it("rejects dependent unloads and restores transferable state on reload", async () => {
    const registry = new ComponentRegistry();
    const loader = new ComponentLoader({
      registry,
      events: new StelleEventBus(),
      dataPlane: new DataPlane(),
      config: {} as never,
    });
    const hydrate = vi.fn();
    const capability: ComponentPackage = {
      id: "capability.test",
      kind: "capability",
      version: "1.0.0",
      displayName: "Test Capability",
      register: vi.fn(),
      snapshotState: async () => ({ pending: ["work-1"] }),
      hydrateState: hydrate,
    };
    const windowPackage: ComponentPackage = {
      id: "window.test",
      kind: "window",
      version: "1.0.0",
      displayName: "Test Window",
      requires: [{ id: capability.id }],
      register: vi.fn(),
      prepareUnload: async () => ({
        acceptNewWork: false,
        pendingWork: "drain",
        reason: "test shutdown",
      }),
    };

    await loader.load(capability);
    await loader.load(windowPackage);
    await loader.start(capability.id);
    await loader.start(windowPackage.id);

    await expect(loader.unload(capability.id)).rejects.toThrow(/depends on it/);

    await loader.unload(windowPackage.id);
    await loader.unload(capability.id);
    await loader.load(capability);

    expect(hydrate).toHaveBeenCalledWith({ pending: ["work-1"] });
    expect(registry.listDebugProviders()).toEqual([]);
  });
});
