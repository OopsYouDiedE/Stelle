import { describe, expect, it, vi } from "vitest";
import { ComponentLoader } from "../../src/core/runtime/component_loader.js";
import { ComponentRegistry } from "../../src/core/runtime/component_registry.js";
import type { ComponentPackage } from "../../src/core/protocol/component.js";

describe("ComponentRegistry", () => {
  it("rejects duplicate package ids", () => {
    const registry = new ComponentRegistry();
    const pkg = packageStub("capability.example");

    registry.register(pkg);

    expect(() => registry.register(pkg)).toThrow(/already registered/);
  });

  it("rejects missing required dependencies", () => {
    const registry = new ComponentRegistry();

    expect(() =>
      registry.register({
        ...packageStub("window.live", "window"),
        requires: [{ id: "capability.runtime_kernel" }],
      }),
    ).toThrow(/Missing required component package/);
  });

  it("starts packages only after required dependencies are active", async () => {
    const registry = new ComponentRegistry();
    const capability = packageStub("capability.runtime_kernel");
    const windowPkg = packageStub("window.live", "window", [{ id: "capability.runtime_kernel" }]);

    registry.register(capability);
    registry.register(windowPkg);

    await expect(registry.start("window.live")).rejects.toThrow(/not active/);
    await registry.start("capability.runtime_kernel");
    await registry.start("window.live");

    expect(registry.getStatus("window.live")).toBe("active");
  });

  it("provides and removes services with package lifecycle", async () => {
    const registry = new ComponentRegistry();
    registry.register({
      ...packageStub("capability.example"),
      register(ctx) {
        ctx.registry.provide("example.service", { value: 42 });
      },
    });

    await registry.start("capability.example");
    expect(registry.resolve<{ value: number }>("example.service")?.value).toBe(42);

    await registry.stop("capability.example");
    expect(registry.resolve("example.service")).toBeUndefined();
  });

  it("keeps debug providers owned by their package and removes them on unload", async () => {
    const registry = new ComponentRegistry();
    registry.register({
      ...packageStub("capability.debuggable"),
      register(ctx) {
        ctx.registry.provideDebugProvider({
          id: "capability.debuggable.debug",
          title: "Debuggable",
          ownerPackageId: ctx.packageId,
        });
      },
    });

    await registry.start("capability.debuggable");
    expect(registry.listDebugProviders()).toHaveLength(1);

    await registry.unregister("capability.debuggable");
    expect(registry.listDebugProviders()).toHaveLength(0);
  });

  it("rejects unloading a package with active dependents", async () => {
    const registry = new ComponentRegistry();
    registry.register(packageStub("capability.stage_output"));
    registry.register(packageStub("window.live", "window", [{ id: "capability.stage_output" }]));
    await registry.start("capability.stage_output");
    await registry.start("window.live");

    await expect(registry.stop("capability.stage_output")).rejects.toThrow(/active dependents/);

    await registry.stop("window.live");
    await registry.stop("capability.stage_output");
    expect(registry.getStatus("capability.stage_output")).toBe("stopped");
  });

  it("loads and stops static package lists in order", async () => {
    const registry = new ComponentRegistry();
    const loader = new ComponentLoader(registry);
    const stopOrder: string[] = [];
    const first = packageStub("capability.first");
    const second = {
      ...packageStub("capability.second", "capability", [{ id: "capability.first" }]),
      stop: vi.fn(() => {
        stopOrder.push("second");
      }),
    };
    const firstWithStop = {
      ...first,
      stop: vi.fn(() => {
        stopOrder.push("first");
      }),
    };

    loader.registerAll([firstWithStop, second]);
    await loader.startAll(["capability.first", "capability.second"]);
    await loader.stopAll(["capability.first", "capability.second"]);

    expect(stopOrder).toEqual(["second", "first"]);
  });
});

function packageStub(
  id: string,
  kind: ComponentPackage["kind"] = "capability",
  requires: ComponentPackage["requires"] = [],
): ComponentPackage {
  return {
    id,
    kind,
    version: "1.0.0",
    requires,
    register() {},
  };
}
