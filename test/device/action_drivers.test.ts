import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceActionIntent } from "../../src/capabilities/action/device_action/types.js";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

describe("real device action drivers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    execFileMock.mockReset();
  });

  it("executes browser navigation through Chrome DevTools Protocol", async () => {
    const { BrowserCdpDriver } = await import("../../src/capabilities/action/browser_control/browser_driver.js");
    const sent: any[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            id: "tab-1",
            type: "page",
            title: "Test",
            url: "https://example.com",
            webSocketDebuggerUrl: "ws://cdp/tab-1",
          },
        ]),
      }),
    );
    vi.stubGlobal(
      "WebSocket",
      makeImmediateWebSocket(sent, (message) => ({ id: message.id, result: {} })),
    );

    const result = await new BrowserCdpDriver().execute(
      deviceIntent({
        resourceKind: "browser",
        actionKind: "navigate",
        risk: "safe_interaction",
        payload: { url: "https://example.org" },
      }),
    );

    expect(result.ok).toBe(true);
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "Page.navigate", params: { url: "https://example.org" } }),
      ]),
    );
  });

  it("reports browser CDP setup failures instead of pretending success", async () => {
    const { BrowserCdpDriver } = await import("../../src/capabilities/action/browser_control/browser_driver.js");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "nope" }));

    const result = await new BrowserCdpDriver().execute(
      deviceIntent({
        resourceKind: "browser",
        actionKind: "observe",
        risk: "readonly",
        payload: {},
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("CDP target list failed");
  });

  it("executes desktop hotkeys through the Windows PowerShell driver", async () => {
    const { DesktopInputDriver } = await import("../../src/capabilities/action/desktop_input/desktop_driver.js");
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, "", ""));

    const result = await new DesktopInputDriver().execute(
      deviceIntent({
        resourceKind: "desktop_input",
        actionKind: "hotkey",
        risk: "safe_interaction",
        payload: { keys: ["Control", "L"] },
      }),
    );

    expect(result.ok).toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(
      "powershell.exe",
      expect.arrayContaining(["-Command", expect.stringContaining("Send-Hotkey")]),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("executes Android taps through adb", async () => {
    const { AndroidAdbDriver } = await import("../../src/capabilities/action/android_device/adb_driver.js");
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, "", ""));

    const result = await new AndroidAdbDriver({ adbPath: "adb" }).execute(
      deviceIntent({
        resourceId: "emulator-5554",
        resourceKind: "android_device",
        actionKind: "android_tap",
        risk: "safe_interaction",
        payload: { x: 10, y: 20 },
      }),
    );

    expect(result.ok).toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(
      "adb",
      ["-s", "emulator-5554", "shell", "input", "tap", "10", "20"],
      expect.any(Object),
      expect.any(Function),
    );
  });
});

function deviceIntent(overrides: Partial<DeviceActionIntent>): DeviceActionIntent {
  return {
    id: "intent-1",
    cursorId: String(overrides.resourceKind ?? "browser"),
    resourceId: "default",
    resourceKind: "browser",
    actionKind: "observe",
    risk: "readonly",
    priority: 50,
    createdAt: 1000,
    ttlMs: 5000,
    reason: "test",
    payload: {},
    ...overrides,
  } as DeviceActionIntent;
}

function makeImmediateWebSocket(sent: any[], responder: (message: any) => any) {
  return class FakeWebSocket {
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onerror?: () => void;
    onclose?: () => void;

    constructor(public readonly url: string) {
      setTimeout(() => this.onopen?.(), 0);
    }

    send(raw: string): void {
      const message = JSON.parse(raw);
      sent.push(message);
      const response = responder(message);
      setTimeout(() => this.onmessage?.({ data: JSON.stringify(response) }), 0);
    }

    close(): void {
      this.onclose?.();
    }
  };
}
