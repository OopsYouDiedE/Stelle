import { describe, expect, it, vi } from "vitest";
import { setupRendererControllers } from "../../src/core/debug_controller.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";

describe("renderer live event controller", () => {
  it("publishes formal live events for program/runtime listeners while preserving legacy cursor compatibility", async () => {
    const eventBus = new StelleEventBus();
    let liveController: any;
    const renderer = {
      setLiveController: vi.fn(controller => {
        liveController = controller;
      }),
      setMemoryController: vi.fn(),
      setDebugController: vi.fn(),
      getStatus: vi.fn(() => ({ connected: true, url: "http://127.0.0.1:8787", socketCount: 0, state: {} })),
    };

    setupRendererControllers({
      renderer,
      config: { debug: { enabled: false } },
      state: { record: vi.fn() },
      cursors: () => [],
      discord: { getStatus: vi.fn() },
      live: () => undefined,
      memory: memoryStub(),
      tools: { list: () => [], audit: [], execute: vi.fn() },
      stageOutput: { snapshot: vi.fn() },
      deviceAction: { snapshot: vi.fn() },
      eventBus,
      proposeSystemLiveOutput: vi.fn(),
      now: () => 1234,
    } as any);

    const result = await liveController.sendLiveEvent({
      source: "fixture",
      cmd: "DANMU_MSG",
      text: "能看到我的弹幕吗？",
      userName: "小星",
    });

    const history = eventBus.getHistory();
    expect(result).toMatchObject({ accepted: true, eventId: "live-event-1234" });
    expect(history.map(event => event.type)).toEqual([
      "live.event.received",
      "live.danmaku.received",
    ]);
    expect(history[0]?.payload).toMatchObject({
      kind: "danmaku",
      text: "能看到我的弹幕吗？",
      user: { name: "小星" },
    });
    expect(history[1]?.payload).toMatchObject(history[0]?.payload);
  });
});

function memoryStub(): any {
  return {
    snapshot: vi.fn(),
    readRecent: vi.fn(),
    searchHistory: vi.fn(),
    readLongTerm: vi.fn(),
    writeLongTerm: vi.fn(),
    appendLongTerm: vi.fn(),
    proposeMemory: vi.fn(),
    listMemoryProposals: vi.fn(),
    approveMemoryProposal: vi.fn(),
    rejectMemoryProposal: vi.fn(),
  };
}
