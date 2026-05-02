import { describe, expect, it, vi } from "vitest";
import { RuntimeHost } from "../../src/runtime/host.js";
import { DiscordRuntime } from "../../src/utils/discord.js";

vi.mock("../../src/windows/live/renderer/renderer_server.js", () => ({
  LiveRendererServer: class {
    start = vi.fn().mockResolvedValue("http://127.0.0.1:8787");
    stop = vi.fn().mockResolvedValue(undefined);
    publish = vi.fn();
    setDebugController = vi.fn();
    getStatus = vi.fn().mockReturnValue({ connected: true, url: "http://127.0.0.1:8787", socketCount: 0, state: {} });
  },
}));

describe("RuntimeHost Isolation", () => {
  it("starts package registries independently without cursor globals", async () => {
    vi.spyOn(DiscordRuntime.prototype, "login").mockResolvedValue(undefined);
    vi.spyOn(DiscordRuntime.prototype, "setBotPresence").mockResolvedValue(undefined);
    vi.spyOn(DiscordRuntime.prototype, "destroy").mockResolvedValue(undefined);

    const app1 = new RuntimeHost("runtime");
    const app2 = new RuntimeHost("runtime");
    vi.spyOn(app1.memory, "start").mockResolvedValue(undefined);
    vi.spyOn(app2.memory, "start").mockResolvedValue(undefined);

    await app1.start();
    await app2.start();

    expect(app1.events).not.toBe(app2.events);
    expect(app1.registry.listActivePackageIds()).toContain("capability.cognition.runtime_kernel");
    expect(app1.registry.listActivePackageIds()).toContain("window.live");
    expect(app1.registry.listPackages().some((pkg) => pkg.id.includes("cursor"))).toBe(false);

    const spy1 = vi.fn();
    const spy2 = vi.fn();
    app1.events.subscribe("perceptual.event", spy1);
    app2.events.subscribe("perceptual.event", spy2);
    app1.events.publish({ type: "perceptual.event", source: "test", payload: { id: "evt" } } as never);

    expect(spy1).toHaveBeenCalled();
    expect(spy2).not.toHaveBeenCalled();

    await app1.stop();
    await app2.stop();
  });
});
