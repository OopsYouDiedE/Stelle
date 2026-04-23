import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GeminiTextProvider,
  KokoroTtsProvider,
  createTtsTools,
  sentenceChunksFromTextStream,
  ToolRegistry,
} from "../index.js";

class FakeGeminiModels {
  textCalls: string[] = [];
  streamCalls: { model?: string; config?: { thinkingConfig?: { thinkingLevel?: string } } }[] = [];

  async generateContentStream(params: { model?: string; config?: { thinkingConfig?: { thinkingLevel?: string } }; contents: { parts: { text: string }[] }[] }) {
    this.streamCalls.push({ model: params.model, config: params.config });
    this.textCalls.push(params.contents[0]?.parts[0]?.text ?? "");
    return asyncGenerator([{ text: "hello " }, { text: "stream" }]);
  }
}

function fakeKokoroFetch(calls: unknown[]): typeof fetch {
  return (async (_url, init) => {
    calls.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(Buffer.from("RIFFfake-wave-data"), {
      status: 200,
      headers: { "content-type": "audio/wav" },
    });
  }) as typeof fetch;
}

test("GeminiTextProvider uses primary and secondary model routes", async () => {
  const models = new FakeGeminiModels();
  const provider = new GeminiTextProvider({
    config: {
      apiKey: "test-key",
      primaryModel: "gemini-3.1-flash-lite-preview",
      secondaryModel: "gemini-3.1-flash-lite-preview",
      ttsModel: "gemini-3.1-flash-tts-preview",
    },
    ai: { models } as never,
  });

  const text = await provider.generateText("news", { role: "primary" });
  const chunks: string[] = [];
  for await (const chunk of provider.generateTextStream("small task", { role: "secondary" })) chunks.push(chunk);

  assert.equal(text, "hello stream");
  assert.deepEqual(chunks, ["hello ", "stream"]);
  assert.equal(provider.modelFor("primary"), "gemini-3.1-flash-lite-preview");
  assert.equal(provider.modelFor("secondary"), "gemini-3.1-flash-lite-preview");
  assert.deepEqual(models.streamCalls.map((call) => call.model), [
    "gemini-3.1-flash-lite-preview",
    "gemini-3.1-flash-lite-preview",
  ]);
  assert.equal(models.streamCalls[0]?.config?.thinkingConfig?.thinkingLevel, "MINIMAL");
});

test("GeminiTextProvider exposes structured stream events while keeping aggregate compatibility", async () => {
  const models = new FakeGeminiModels();
  const provider = new GeminiTextProvider({
    config: {
      apiKey: "test-key",
      primaryModel: "gemini-3.1-flash-lite-preview",
      secondaryModel: "gemini-3.1-flash-lite-preview",
      ttsModel: "gemini-3.1-flash-tts-preview",
    },
    ai: { models } as never,
  });

  const events = [];
  for await (const event of provider.generateTextEvents("event stream", { role: "primary" })) events.push(event);

  assert.deepEqual(events.map((event) => event.type), ["delta", "delta", "done"]);
  assert.equal(events[0]?.text, "hello ");
  assert.equal(events[2]?.text, "hello stream");
});

test("sentenceChunksFromTextStream turns token deltas into TTS-sized sentence chunks", async () => {
  const chunks: string[] = [];
  for await (const chunk of sentenceChunksFromTextStream(asyncGenerator(["你好，", "这是第一句。第二", "句继续", "输出。尾巴"]), {
    maxChars: 12,
  })) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, ["你好，这是第一句。", "第二句继续输出。", "尾巴"]);
});

test("KokoroTtsProvider accepts streamed text chunks and writes wav artifacts", async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "stelle-tts-"));
  const calls: unknown[] = [];
  const provider = new KokoroTtsProvider({
    outputDir,
    baseUrl: "http://kokoro.test",
    model: "kokoro",
    voiceName: "af_heart",
    fetcher: fakeKokoroFetch(calls),
  });

  const artifacts = await provider.synthesizeTextStream(asyncGenerator(["第一句。", "第二句。"]), {
    filePrefix: "unit",
  });

  assert.equal(artifacts.length, 2);
  assert.ok(artifacts[0]?.path.endsWith(".wav"));
  assert.equal((await fs.readFile(artifacts[0]!.path)).subarray(0, 4).toString("ascii"), "RIFF");
  assert.deepEqual(calls, [
    { model: "kokoro", input: "第一句。", voice: "af_heart", response_format: "wav" },
    { model: "kokoro", input: "第二句。", voice: "af_heart", response_format: "wav" },
  ]);
});

test("tts.kokoro_stream_speech tool exposes Kokoro TTS streaming", async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "stelle-tts-tool-"));
  const calls: unknown[] = [];
  const provider = new KokoroTtsProvider({
    outputDir,
    baseUrl: "http://kokoro.test",
    fetcher: fakeKokoroFetch(calls),
  });
  const registry = new ToolRegistry();
  for (const tool of createTtsTools(provider)) registry.register(tool);

  const result = await registry.execute("tts.kokoro_stream_speech", {
    chunks: ["hello", " live"],
    output_dir: outputDir,
    file_prefix: "tool",
    voice_name: "af_sarah",
    speed: 1.1,
  }, {
    caller: "stelle",
    authority: { caller: "stelle", allowedAuthorityClasses: ["stelle"] },
    audit: { record() {} },
  });

  assert.equal(result.ok, true);
  assert.equal((result.data?.artifacts as unknown[]).length, 2);
  assert.deepEqual(calls[0], { model: "kokoro", input: "hello", voice: "af_sarah", response_format: "wav", speed: 1.1 });
});

async function* asyncGenerator<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}
