import { describe, expect, it, vi } from "vitest";
import { ComponentRegistry } from "../../src/core/runtime/component_registry.js";
import { ComponentLoader } from "../../src/core/runtime/component_loader.js";
import { DataPlane } from "../../src/core/runtime/data_plane.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";
import { liveWindowPackage } from "../../src/windows/live/package.js";
import { discordWindowPackage } from "../../src/windows/discord/package.js";
import { browserWindowPackage } from "../../src/windows/browser/package.js";
import { desktopInputWindowPackage } from "../../src/windows/desktop_input/package.js";
import { BrowserWindow } from "../../src/windows/browser/browser_window.js";
import { DesktopInputWindow } from "../../src/windows/desktop_input/desktop_input_window.js";

describe("Window packages", () => {
  it("loads live and discord windows without direct kernel or stage-output dependencies", async () => {
    const registry = new ComponentRegistry();
    const events = new StelleEventBus();
    const loader = new ComponentLoader({ registry, events, dataPlane: new DataPlane(), config: config() as never });

    await loader.load(liveWindowPackage);
    await loader.start(liveWindowPackage.id);
    await loader.load(discordWindowPackage);
    await loader.start(discordWindowPackage.id);

    expect(registry.resolve("window.live")).toBeTruthy();
    expect(registry.resolve("window.discord")).toBeTruthy();
  });

  it("publishes browser and desktop state through DataPlane resource refs", async () => {
    const registry = new ComponentRegistry();
    const dataPlane = new DataPlane();
    const events = new StelleEventBus();
    const loader = new ComponentLoader({ registry, events, dataPlane, config: config() as never });

    registry.register({
      id: "capability.action.device_action",
      kind: "capability",
      version: "1.0.0",
      displayName: "Device Action",
      register(ctx) {
        ctx.registry.provide("action.device_action", { propose: vi.fn() });
      },
    });
    registry.markActive("capability.action.device_action");

    await loader.load(browserWindowPackage);
    await loader.load(desktopInputWindowPackage);
    await loader.start(browserWindowPackage.id);
    await loader.start(desktopInputWindowPackage.id);

    const browserRef = await registry.resolve<BrowserWindow>("window.browser")!.publishSnapshot({ url: "about:blank" });
    const desktopRef = await registry
      .resolve<DesktopInputWindow>("window.desktop_input")!
      .publishState({ active: true });

    expect(browserRef.kind).toBe("browser_snapshot");
    expect(desktopRef.kind).toBe("scene_snapshot");
    expect(dataPlane.listResourceRefs().map((ref) => ref.ownerPackageId)).toEqual(
      expect.arrayContaining(["window.browser", "window.desktop_input"]),
    );
  });
});

function config() {
  return {
    live: { platforms: { bilibili: { enabled: false } }, ttsEnabled: false, speechQueueLimit: 3 },
    discord: { enabled: false },
    debug: { enabled: false },
    control: {},
  };
}
