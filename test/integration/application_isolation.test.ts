import { describe, it, expect, vi, beforeEach } from "vitest";
import { StelleApplication } from "../../src/core/application.js";

// Mock entire modules that start servers or have side effects
vi.mock("../../src/utils/renderer.js", () => ({
  LiveRendererServer: class {
    start = vi.fn().mockResolvedValue("http://127.0.0.1:8787");
    stop = vi.fn().mockResolvedValue(undefined);
    publish = vi.fn();
    setLiveController = vi.fn();
    setDebugController = vi.fn();
    getStatus = vi.fn().mockReturnValue({ connected: true });
  },
}));

describe("StelleApplication Isolation", () => {
  it("should initialize and stop cursors correctly without global side effects", async () => {
    // Start Application 1
    const app1 = new StelleApplication("runtime");
    (app1 as any).config.discord.token = "test-token";
    (app1 as any).config.models.apiKey = "test-key";
    
    vi.spyOn(app1.memory, "start").mockResolvedValue(undefined);
    vi.spyOn(app1.discord, "login").mockResolvedValue(undefined);

    await app1.start();
    const eventBus1 = app1.eventBus;
    
    expect(app1.cursors.length).toBeGreaterThan(0);

    // Start Application 2
    const app2 = new StelleApplication("runtime");
    (app2 as any).config.discord.token = "test-token-2";
    (app2 as any).config.models.apiKey = "test-key-2";
    vi.spyOn(app2.memory, "start").mockResolvedValue(undefined);
    vi.spyOn(app2.discord, "login").mockResolvedValue(undefined);
    
    await app2.start();
    const eventBus2 = app2.eventBus;

    expect(eventBus1).not.toBe(eventBus2);

    // Test event isolation
    const spy1 = vi.fn();
    const spy2 = vi.fn();
    eventBus1.subscribe("inner.tick", spy1);
    eventBus2.subscribe("inner.tick", spy2);

    eventBus1.publish({ type: "inner.tick", reason: "test1" });
    expect(spy1).toHaveBeenCalled();
    expect(spy2).not.toHaveBeenCalled();

    // Cleanup
    await app1.stop();
    await app2.stop();
  });
});
