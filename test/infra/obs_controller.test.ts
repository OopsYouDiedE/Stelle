import { afterEach, describe, expect, it, vi } from "vitest";
import { ObsWebSocketController } from "../../src/utils/live.js";

describe("ObsWebSocketController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads OBS status through WebSocket v5", async () => {
    const sent: any[] = [];
    vi.stubGlobal("WebSocket", makeObsWebSocket(sent, {
      GetStreamStatus: { outputActive: true },
      GetCurrentProgramScene: { currentProgramSceneName: "Live" },
    }));

    const status = await new ObsWebSocketController({ enabled: true, url: "ws://obs", timeoutMs: 1000 }).getStatus();

    expect(status.connected).toBe(true);
    expect(status.streaming).toBe(true);
    expect(status.currentScene).toBe("Live");
    expect(sent.map(message => message.op)).toEqual(expect.arrayContaining([1, 6]));
  });

  it("sends OBS scene switch requests", async () => {
    const sent: any[] = [];
    vi.stubGlobal("WebSocket", makeObsWebSocket(sent, {
      SetCurrentProgramScene: {},
      GetStreamStatus: { outputActive: false },
      GetCurrentProgramScene: { currentProgramSceneName: "BRB" },
    }));

    const result = await new ObsWebSocketController({ enabled: true, url: "ws://obs", timeoutMs: 1000 }).setCurrentScene("BRB");

    expect(result.ok).toBe(true);
    expect(sent).toContainEqual(expect.objectContaining({
      op: 6,
      d: expect.objectContaining({
        requestType: "SetCurrentProgramScene",
        requestData: { sceneName: "BRB" },
      }),
    }));
  });

  it("fails closed when OBS control is disabled", async () => {
    const result = await new ObsWebSocketController({ enabled: false }).startStream();

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("disabled");
  });
});

function makeObsWebSocket(sent: any[], responses: Record<string, Record<string, unknown>>) {
  return class FakeObsWebSocket {
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onerror?: () => void;
    onclose?: () => void;

    constructor(public readonly url: string) {
      setTimeout(() => {
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify({ op: 0, d: { obsWebSocketVersion: "5.0.0", rpcVersion: 1 } }) });
      }, 0);
    }

    send(raw: string): void {
      const message = JSON.parse(raw);
      sent.push(message);
      if (message.op === 1) {
        setTimeout(() => this.onmessage?.({ data: JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }) }), 0);
        return;
      }
      if (message.op === 6) {
        const requestType = String(message.d.requestType);
        setTimeout(() => this.onmessage?.({
          data: JSON.stringify({
            op: 7,
            d: {
              requestId: message.d.requestId,
              requestType,
              requestStatus: { result: true, code: 100 },
              responseData: responses[requestType] ?? {},
            },
          }),
        }), 0);
      }
    }

    close(): void {
      this.onclose?.();
    }
  };
}
