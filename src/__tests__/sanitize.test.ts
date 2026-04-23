import assert from "node:assert/strict";
import test from "node:test";

import {
  KokoroTtsProvider,
  Live2DModelRegistry,
  LiveRuntime,
  ToolRegistry,
  createTtsTools,
  sanitizeExternalText,
  type LiveRendererCommand,
} from "../index.js";

test("sanitizeExternalText removes internal thought blocks and dangling tags", () => {
  assert.equal(
    sanitizeExternalText("开场<thought>不要外显这段</thought>继续说"),
    "开场继续说"
  );
  assert.equal(
    sanitizeExternalText("可以播出。\n<thinking>这里开始的内容都不能漏"),
    "可以播出。"
  );
  assert.equal(
    sanitizeExternalText("<analysis>hidden</analysis><reasoning>secret</reasoning>公开内容"),
    "公开内容"
  );
});

test("LiveRuntime sanitizes captions and audio text before renderer output", async () => {
  const commands: LiveRendererCommand[] = [];
  const runtime = new LiveRuntime(new Live2DModelRegistry(), undefined as never, {
    publish(command) {
      commands.push(command);
    },
  });

  await runtime.setCaption("字幕<thought>内部推理</thought>可见");
  await runtime.playAudio("/artifacts/tts/test.wav", "语音<thinking>内部草稿</thinking>可见");

  assert.deepEqual(commands[0], { type: "caption:set", text: "字幕可见" });
  assert.deepEqual(commands[1], { type: "audio:play", url: "/artifacts/tts/test.wav", text: "语音可见" });
});

test("Kokoro TTS tool sanitizes speech input before synthesis", async () => {
  const calls: unknown[] = [];
  const provider = new KokoroTtsProvider({
    baseUrl: "http://kokoro.test",
    fetcher: (async (_url, init) => {
      calls.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(Buffer.from("RIFFfake-wave-data"), {
        status: 200,
        headers: { "content-type": "audio/wav" },
      });
    }) as typeof fetch,
  });
  const registry = new ToolRegistry();
  for (const tool of createTtsTools(provider)) registry.register(tool);

  const result = await registry.execute("tts.kokoro_stream_speech", {
    chunks: ["第一句<thought>内部</thought>", "<analysis>删掉</analysis>第二句"],
    file_prefix: "sanitize",
  }, {
    caller: "stelle",
    authority: { caller: "stelle", allowedAuthorityClasses: ["stelle"] },
    audit: { record() {} },
  });

  assert.equal(result.ok, true);
  assert.equal((calls[0] as { input?: string }).input, "第一句");
  assert.equal((calls[1] as { input?: string }).input, "第二句");
});
test("LiveRuntime sanitizes Kokoro stream commands before renderer output", async () => {
  const commands: LiveRendererCommand[] = [];
  const runtime = new LiveRuntime(new Live2DModelRegistry(), undefined as never, {
    publish(command) {
      commands.push(command);
    },
  });

  await runtime.playTtsStream("stream<thought>hidden</thought>visible", { voiceName: "zf_xiaobei", language: "z" });

  assert.equal(commands[0]?.type, "audio:stream");
  assert.equal((commands[0] as { text?: string }).text, "streamvisible");
  assert.equal((commands[0] as { request?: { input?: string; stream?: boolean } }).request?.input, "streamvisible");
  assert.equal((commands[0] as { request?: { stream?: boolean } }).request?.stream, true);
});
