import assert from "node:assert/strict";
import test from "node:test";

import {
  CoreMind,
  createDefaultToolRegistry,
  createLiveCursorTools,
  CursorRegistry,
  CursorRuntime,
  Live2DModelRegistry,
  LiveCursor,
  LiveRuntime,
  ObsWebSocketController,
  TestCursor,
  ToolRegistry,
} from "../index.js";
import type { LiveActionResult, ObsController, ObsStatus } from "../index.js";

class FakeObsController implements ObsController {
  status: ObsStatus = {
    enabled: true,
    connected: true,
    streaming: false,
    currentScene: "Idle",
  };

  async getStatus(): Promise<ObsStatus> {
    return { ...this.status };
  }

  async startStream(): Promise<LiveActionResult> {
    this.status = { ...this.status, streaming: true };
    return { ok: true, summary: "fake stream started", timestamp: Date.now(), obs: { ...this.status } };
  }

  async stopStream(): Promise<LiveActionResult> {
    this.status = { ...this.status, streaming: false };
    return { ok: true, summary: "fake stream stopped", timestamp: Date.now(), obs: { ...this.status } };
  }

  async setCurrentScene(sceneName: string): Promise<LiveActionResult> {
    this.status = { ...this.status, currentScene: sceneName };
    return { ok: true, summary: `fake scene ${sceneName}`, timestamp: Date.now(), obs: { ...this.status } };
  }
}

class FakeObsSocket {
  readonly sent: string[] = [];
  readyState = 1;
  private readonly listeners = new Map<string, ((event: { data?: unknown; error?: unknown }) => void)[]>();
  private identified = false;

  constructor(readonly url: string) {
    queueMicrotask(() => {
      this.emit("message", {
        data: JSON.stringify({ op: 0, d: { rpcVersion: 1 } }),
      });
    });
  }

  send(data: string): void {
    this.sent.push(data);
    const message = JSON.parse(data) as { op: number; d?: { requestType?: string; requestId?: string; requestData?: Record<string, unknown> } };
    if (message.op === 1 && !this.identified) {
      this.identified = true;
      queueMicrotask(() => this.emit("message", { data: JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }) }));
      return;
    }
    if (message.op === 6) {
      const requestType = message.d?.requestType;
      const requestId = message.d?.requestId;
      const responseData =
        requestType === "GetStreamStatus"
          ? { outputActive: false }
          : requestType === "GetCurrentProgramScene"
            ? { currentProgramSceneName: "Scene A" }
            : {};
      queueMicrotask(() =>
        this.emit("message", {
          data: JSON.stringify({
            op: 7,
            d: {
              requestId,
              requestType,
              requestStatus: { result: true, code: 100 },
              responseData,
            },
          }),
        })
      );
    }
  }

  close(): void {
    this.readyState = 3;
  }

  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: { data?: unknown; error?: unknown }) => void): void {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  private emit(type: string, event: { data?: unknown; error?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

test("Live2D model registry imports Hiyori and Hiyori Pro resource metadata", async () => {
  const registry = new Live2DModelRegistry();

  const models = registry.list();
  const hiyori = registry.get("Hiyori");
  const pro = registry.get("Hiyori_pro");
  const proAssets = await registry.checkAssets("Hiyori_pro");

  assert.deepEqual(models.map((model) => model.id), ["Hiyori", "Hiyori_pro"]);
  assert.equal(hiyori?.jsonName, "Hiyori.model3.json");
  assert.equal(pro?.motions.flickBody, "Flick@Body");
  assert.equal(proAssets.ok, true);
});

test("LiveCursor runs independently and exposes local stage tools", async () => {
  const cursors = new CursorRegistry();
  const liveCursor = new LiveCursor(new LiveRuntime(new Live2DModelRegistry(), new FakeObsController()));
  cursors.register(liveCursor);

  const tools = new ToolRegistry();
  for (const tool of createLiveCursorTools(cursors)) tools.register(tool);
  const runtime = new CursorRuntime(cursors, tools);
  await runtime.startCursor("live");

  const reports = await runtime.sendInput("live", {
    type: "text",
    content: "preview caption",
    metadata: { liveAction: "caption" },
  });
  assert.equal(reports[0]?.type, "live_caption_preview");

  const stage = await runtime.useCursorTool("live", "live.cursor_get_stage", {});
  assert.equal(stage.ok, true);
  assert.equal((stage.data?.stage as { caption?: string }).caption, "preview caption");

  const status = await runtime.useCursorTool("live", "live.cursor_status", {});
  assert.equal(status.ok, true);
  assert.equal((status.data?.status as { obs: { streaming: boolean } }).obs.streaming, false);
});

test("Live Stelle tools work while CoreMind is attached to a different Cursor", async () => {
  const cursors = new CursorRegistry();
  cursors.register(new TestCursor());
  cursors.register(new LiveCursor(new LiveRuntime(new Live2DModelRegistry(), new FakeObsController())));
  const tools = createDefaultToolRegistry(cursors);
  const core = await CoreMind.create({ cursors, tools, defaultCursorId: "test" });

  const motion = await core.useTool("live.stelle_trigger_motion", {
    group: "Tap",
    priority: "normal",
  });
  assert.equal(motion.ok, true);
  assert.equal(motion.sideEffects?.[0]?.visible, true);

  const scene = await core.useTool("live.obs_set_scene", {
    scene_name: "Chat",
  });
  assert.equal(scene.ok, true);
  assert.equal((scene.data?.result as { obs?: ObsStatus }).obs?.currentScene, "Chat");

  const start = await core.useTool("live.obs_start_stream", {});
  assert.equal(start.ok, true);
  assert.equal((start.data?.result as { obs?: ObsStatus }).obs?.streaming, true);
});

test("Live Stelle speech queue preloads content and plays it on cursor tick", async () => {
  const previousLiveTts = process.env.LIVE_TTS_ENABLED;
  process.env.LIVE_TTS_ENABLED = "false";
  const cursors = new CursorRegistry();
  const liveCursor = new LiveCursor(new LiveRuntime(new Live2DModelRegistry(), new FakeObsController()));
  cursors.register(new TestCursor());
  cursors.register(liveCursor);
  const tools = createDefaultToolRegistry(cursors);
  const core = await CoreMind.create({ cursors, tools, defaultCursorId: "test" });

  const queued = await core.useTool("live.stelle_enqueue_speech", {
    chunks: ["第一段直播语料。", "第二段慢慢讲。"],
    source: "unit",
  });
  assert.equal(queued.ok, true);
  assert.equal(liveCursor.getSpeechQueue().length, 2);

  const reports = await liveCursor.tick();
  assert.equal(reports[0]?.type, "live_speech_queue_played");
  const stage = await liveCursor.live.getStatus();
  assert.equal(stage.stage.caption, "第一段直播语料。");
  assert.equal(liveCursor.getSpeechQueue().length, 1);
  process.env.LIVE_TTS_ENABLED = previousLiveTts;
});

test("OBS tools report structured unavailable when OBS control is disabled", async () => {
  const previousObsControl = process.env.OBS_CONTROL_ENABLED;
  process.env.OBS_CONTROL_ENABLED = "false";
  const cursors = new CursorRegistry();
  cursors.register(new LiveCursor());
  const tools = createDefaultToolRegistry(cursors);
  const core = await CoreMind.create({ cursors, tools, defaultCursorId: "live" });

  const result = await core.useTool("live.obs_start_stream", {});

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "obs_unavailable");
  assert.match(result.summary, /disabled|unavailable|WebSocket/i);
  process.env.OBS_CONTROL_ENABLED = previousObsControl;
});

test("ObsWebSocketController speaks minimal OBS WebSocket v5 request flow", async () => {
  const sockets: FakeObsSocket[] = [];
  const controller = new ObsWebSocketController({
    enabled: true,
    url: "ws://obs.test:4455",
    socketFactory: (url) => {
      const socket = new FakeObsSocket(url);
      sockets.push(socket);
      return socket;
    },
  });

  const start = await controller.startStream();
  const scene = await controller.setCurrentScene("Live");
  const stop = await controller.stopStream();

  assert.equal(start.ok, true);
  assert.equal(scene.ok, true);
  assert.equal(stop.ok, true);
  assert.equal(sockets.length, 3);
  assert.deepEqual(
    sockets.flatMap((socket) => socket.sent.map((item) => JSON.parse(item) as { op: number; d?: { requestType?: string } }))
      .filter((message) => message.op === 6)
      .map((message) => message.d?.requestType),
    ["StartStream", "SetCurrentProgramScene", "StopStream"]
  );
});
