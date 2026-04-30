import { describe, it, expect, vi, afterEach } from "vitest";
import { LiveRendererServer, type LiveRendererLiveController, type LiveRendererMemoryController } from "../../src/live/infra/renderer_server.js";
import { HttpLiveRendererBridge } from "../../src/utils/live.js";

describe("LiveRendererServer Security", () => {
  let server: LiveRendererServer;
  const port = 0; // Random port

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  it("should allow HttpLiveRendererBridge to publish with controlToken", async () => {
    server = new LiveRendererServer({
      port,
      control: {
        requireToken: true,
        token: "bridge-test-token",
      },
    });
    const url = await server.start();
    const bridge = new HttpLiveRendererBridge(url, { controlToken: "bridge-test-token" });
    
    // Use a state:set command to prove mutation
    const testState = { visible: true, customValue: "verified" };
    await bridge.publish({ type: "state:set", state: testState });

    expect(bridge.lastError).toBeUndefined();
    
    // Verify state was actually mutated in the server
    const response = await fetch(`${url}/state`);
    const data = await response.json() as any;
    expect(data.ok).toBe(true);
    expect(data.state).toMatchObject(testState);
  });

  it("should reject unauthenticated POST /api/live/event when control token is required", async () => {
    const mockController: LiveRendererLiveController = {
      sendLiveEvent: vi.fn().mockResolvedValue({ accepted: true }),
    };
    server = new LiveRendererServer({
      port,
      control: {
        requireToken: true,
        token: "test-token",
      },
      liveController: mockController,
    });
    const url = await server.start();

    const response = await fetch(`${url}/api/live/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });

    expect(response.status).toBe(401);
    expect(mockController.sendLiveEvent).not.toHaveBeenCalled();
  });

  it("should allow authenticated POST /api/live/event with Bearer token", async () => {
    const mockController: LiveRendererLiveController = {
      sendLiveEvent: vi.fn().mockResolvedValue({ accepted: true }),
    };
    server = new LiveRendererServer({
      port,
      control: {
        requireToken: true,
        token: "test-token",
      },
      liveController: mockController,
    });
    const url = await server.start();

    const response = await fetch(`${url}/api/live/event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-token",
      },
      body: JSON.stringify({ text: "hello" }),
    });

    expect(response.status).toBe(200);
    expect(mockController.sendLiveEvent).toHaveBeenCalled();
  });

  it("should allow authenticated POST /api/live/event with token in query", async () => {
    const mockController: LiveRendererLiveController = {
      sendLiveEvent: vi.fn().mockResolvedValue({ accepted: true }),
    };
    server = new LiveRendererServer({
      port,
      control: {
        requireToken: true,
        token: "test-token",
      },
      liveController: mockController,
    });
    const url = await server.start();

    const response = await fetch(`${url}/api/live/event?token=test-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });

    expect(response.status).toBe(200);
    expect(mockController.sendLiveEvent).toHaveBeenCalled();
  });

  it("should reject unauthenticated POST /command and not publish", async () => {
    server = new LiveRendererServer({
      port,
      control: {
        requireToken: true,
        token: "test-token",
      },
    });
    const url = await server.start();
    const publishSpy = vi.spyOn(server, "publish");

    const response = await fetch(`${url}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "test" }),
    });

    expect(response.status).toBe(401);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("should allow public control routes when requireToken is false", async () => {
    const mockController: LiveRendererLiveController = {
      sendLiveEvent: vi.fn().mockResolvedValue({ accepted: true }),
    };
    server = new LiveRendererServer({
      port,
      control: {
        requireToken: false,
      },
      liveController: mockController,
    });
    const url = await server.start();

    const response = await fetch(`${url}/api/live/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });

    expect(response.status).toBe(200);
    expect(mockController.sendLiveEvent).toHaveBeenCalled();
  });

  it("should fail closed if token is required but not configured", async () => {
    server = new LiveRendererServer({
      port,
      control: {
        requireToken: true,
        // token missing
      },
    });
    const url = await server.start();

    const response = await fetch(`${url}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "test" }),
    });

    expect(response.status).toBe(403);
  });

  it("protects memory API routes with the control token", async () => {
    const mockController: LiveRendererMemoryController = {
      readRecent: vi.fn().mockResolvedValue([]),
    };
    server = new LiveRendererServer({
      port,
      control: {
        requireToken: true,
        token: "memory-token",
      },
      memoryController: mockController,
    });
    const url = await server.start();

    const rejected = await fetch(`${url}/api/memory/recent/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: { kind: "live" } }),
    });
    const accepted = await fetch(`${url}/api/memory/recent/read?token=memory-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: { kind: "live" }, limit: 5 }),
    });

    expect(rejected.status).toBe(401);
    expect(accepted.status).toBe(200);
    expect(mockController.readRecent).toHaveBeenCalledWith({ kind: "live" }, 5);
  });

  it("protects /control with the control token", async () => {
    server = new LiveRendererServer({
      port,
      control: {
        requireToken: true,
        token: "control-token",
      },
    });
    const url = await server.start();

    const rejected = await fetch(`${url}/control`);
    const accepted = await fetch(`${url}/control?token=control-token`);

    expect(rejected.status).toBe(401);
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toContain("Stelle Live Control");
  });

  it("serves /debug as a debug-token protected alias for /_debug", async () => {
    server = new LiveRendererServer({
      port,
      debug: {
        enabled: true,
        requireToken: true,
        token: "debug-token",
      },
    });
    const url = await server.start();

    const rejected = await fetch(`${url}/debug`);
    const accepted = await fetch(`${url}/debug?token=debug-token`);
    const legacy = await fetch(`${url}/_debug?token=debug-token`);

    expect(rejected.status).toBe(401);
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toContain("Stelle Debug Panel");
    expect(legacy.status).toBe(200);
  });

  it("runs debug live control commands with the debug token, not the control token", async () => {
    const mockController: LiveRendererLiveController = {
      runControlCommand: vi.fn().mockResolvedValue({ command: "mute_tts", muted: true }),
    };
    server = new LiveRendererServer({
      port,
      debug: {
        enabled: true,
        requireToken: true,
        token: "debug-token",
      },
      control: {
        requireToken: true,
        token: "control-token",
      },
      liveController: mockController,
    });
    const url = await server.start();

    const rejected = await fetch(`${url}/_debug/api/live/control?token=control-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "mute_tts" }),
    });
    const accepted = await fetch(`${url}/_debug/api/live/control?token=debug-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "mute_tts" }),
    });

    expect(rejected.status).toBe(401);
    expect(accepted.status).toBe(200);
    expect(mockController.runControlCommand).toHaveBeenCalledTimes(1);
    expect(mockController.runControlCommand).toHaveBeenCalledWith({ command: "mute_tts" });
  });
});
