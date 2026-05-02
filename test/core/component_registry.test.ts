import { describe, expect, it, vi } from "vitest";
import { ComponentRegistry } from "../../src/core/runtime/component_registry.js";
import { ComponentLoader } from "../../src/core/runtime/component_loader.js";
import { StelleEventBus } from "../../src/core/event/event_bus.js";
import type { ComponentPackage } from "../../src/core/protocol/component.js";

describe("Component System", () => {
  it("should register and start a package", async () => {
    const registry = new ComponentRegistry();
    const events = new StelleEventBus();
    const loader = new ComponentLoader({ registry, events });

    const pkg: ComponentPackage = {
      id: "test.pkg",
      kind: "capability",
      version: "1.0.0",
      displayName: "Test Package",
      register: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };

    await loader.load(pkg);
    expect(pkg.register).toHaveBeenCalled();
    expect(registry.getPackage("test.pkg")).toBe(pkg);

    await loader.start("test.pkg");
    expect(pkg.start).toHaveBeenCalled();
    expect(registry.isActive("test.pkg")).toBe(true);
  });

  it("should enforce dependencies", async () => {
    const registry = new ComponentRegistry();
    const events = new StelleEventBus();
    const loader = new ComponentLoader({ registry, events });

    const dep: ComponentPackage = {
      id: "dependency",
      kind: "capability",
      version: "1.0.0",
      displayName: "Dep",
      register: vi.fn(),
    };

    const pkg: ComponentPackage = {
      id: "main",
      kind: "capability",
      version: "1.0.0",
      displayName: "Main",
      requires: [{ id: "dependency" }],
      register: vi.fn(),
      start: vi.fn(),
    };

    await loader.load(dep);
    await loader.load(pkg);

    // Should fail because dependency is not started
    await expect(loader.start("main")).rejects.toThrow(/is not active/);

    await loader.start("dependency");
    await loader.start("main");
    expect(registry.isActive("main")).toBe(true);
  });

  it("should manage services and debug providers", async () => {
    const registry = new ComponentRegistry();
    const mockService = { hello: () => "world" };

    registry.provide("test.service", mockService);
    expect(registry.resolve("test.service")).toBe(mockService);

    const debugProvider = {
      id: "test.debug",
      title: "Test Debug",
      ownerPackageId: "test.pkg",
    };

    registry.provideDebugProvider(debugProvider);
    expect(registry.listDebugProviders()).toContain(debugProvider);
  });

  it("should prevent stopping a package if others depend on it", async () => {
    const registry = new ComponentRegistry();
    const events = new StelleEventBus();
    const loader = new ComponentLoader({ registry, events });

    const dep: ComponentPackage = {
      id: "dependency",
      kind: "capability",
      version: "1.0.0",
      displayName: "Dep",
      register: vi.fn(),
      stop: vi.fn(),
    };

    const pkg: ComponentPackage = {
      id: "main",
      kind: "capability",
      version: "1.0.0",
      displayName: "Main",
      requires: [{ id: "dependency" }],
      register: vi.fn(),
      start: vi.fn(),
    };

    await loader.load(dep);
    await loader.load(pkg);
    await loader.start("dependency");
    await loader.start("main");

    await expect(loader.stop("dependency")).rejects.toThrow(/depends on it/);

    await loader.stop("main");
    await loader.stop("dependency");
    expect(registry.isActive("dependency")).toBe(false);
  });

  it("should remove package-owned services and debug providers on unload", async () => {
    const registry = new ComponentRegistry();
    const events = new StelleEventBus();
    const loader = new ComponentLoader({ registry, events });

    const pkg: ComponentPackage = {
      id: "owned.pkg",
      kind: "capability",
      version: "1.0.0",
      displayName: "Owned",
      register(ctx) {
        ctx.registry.provideForPackage?.("owned.pkg", "owned.service", { ok: true });
        ctx.registry.provideDebugProvider({ id: "owned.debug", title: "Owned", ownerPackageId: "owned.pkg" });
      },
    };

    await loader.load(pkg);
    await loader.start("owned.pkg");
    await loader.unload("owned.pkg");

    expect(registry.resolve("owned.service")).toBeUndefined();
    expect(registry.listDebugProviders()).toHaveLength(0);
  });

  it("should hydrate state snapshots when a package is reloaded", async () => {
    const registry = new ComponentRegistry();
    const events = new StelleEventBus();
    const loader = new ComponentLoader({ registry, events });
    const hydrate = vi.fn();

    const pkg: ComponentPackage = {
      id: "stateful.pkg",
      kind: "capability",
      version: "1.0.0",
      displayName: "Stateful",
      register: vi.fn(),
      snapshotState: async () => ({ pending: ["intent-1"] }),
      hydrateState: hydrate,
    };

    await loader.load(pkg);
    await loader.start(pkg.id);
    await loader.unload(pkg.id);
    await loader.load(pkg);

    expect(hydrate).toHaveBeenCalledWith({ pending: ["intent-1"] });
  });
});
