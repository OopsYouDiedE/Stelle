import { describe, expect, it, vi } from "vitest";
import { ComponentRegistry } from "../../src/core/runtime/component_registry.js";
import { ComponentLoader } from "../../src/core/runtime/component_loader.js";
import { StelleEventBus } from "../../src/core/event/event_bus.js";
import { runtimeKernelCapability } from "../../src/capabilities/cognition/runtime_kernel/package.js";
import { stageOutputCapability } from "../../src/capabilities/expression/stage_output/package.js";
import { liveWindowPackage } from "../../src/windows/live/package.js";
import { LiveWindow } from "../../src/windows/live/live_window.js";
import type { RuntimeConfig } from "../../src/core/config/runtime_config.js";

describe("Live V2 Flow Integration", () => {
  it("should process danmaku through window -> kernel -> stage output", async () => {
    const registry = new ComponentRegistry();
    const events = new StelleEventBus();
    const config = {
      live: { platforms: { bilibili: { enabled: false } }, ttsEnabled: false, speechQueueLimit: 3 },
      debug: { enabled: false },
    } as RuntimeConfig;
    const loader = new ComponentLoader({ registry, events, config: config as never });

    await loader.load(runtimeKernelCapability);
    await loader.load(stageOutputCapability);

    await loader.load(liveWindowPackage);

    await loader.start(runtimeKernelCapability.id);
    await loader.start(stageOutputCapability.id);
    await loader.start(liveWindowPackage.id);

    const liveWindow = registry.resolve<LiveWindow>("window.live")!;

    await liveWindow.receivePlatformEvent({
      id: "evt_live_1",
      source: "fixture",
      kind: "danmaku",
      priority: "medium",
      receivedAt: Date.now(),
      user: { id: "user_456", name: "Viewer" },
      text: "Hello Stelle?",
    });

    await vi.waitFor(() => {
      expect(events.getHistory().map((event) => event.type)).toEqual(
        expect.arrayContaining(["perceptual.event", "cognition.intent", "stage.output.accepted"]),
      );
    });
    const accepted = events.getHistory().find((event) => event.type === "stage.output.accepted");
    expect((accepted?.payload as any).intent.text).toContain("Hello Stelle?");
  });
});
