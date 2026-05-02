import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DashScopeTtsProvider,
  buildDashScopeSpeechRequest,
  buildLiveTtsRequest,
  fetchLiveTtsAudio,
} from "../../src/capabilities/expression/speech_output/tts_provider.js";
import { LiveRuntime, type LiveRendererBridge } from "../../src/windows/stage/bridge/live_runtime.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe("DashScope Qwen-TTS", () => {
  it("builds instruct multimodal-generation requests for virtual-host live speech", () => {
    const request = buildDashScopeSpeechRequest("大家晚上好呀", {
      model: "qwen3-tts-instruct-flash",
      voiceName: "Cherry",
      language: "Chinese",
      instructions: "语气活泼、亲切",
      optimizeInstructions: true,
    });

    expect(request).toEqual({
      model: "qwen3-tts-instruct-flash",
      input: {
        text: "大家晚上好呀",
        voice: "Cherry",
        language_type: "Chinese",
        instructions: "语气活泼、亲切",
        optimize_instructions: true,
      },
    });
  });

  it("follows DashScope audio URLs and writes an artifact", async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      calls.push({ url: href, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (href.includes("/services/aigc/multimodal-generation/generation")) {
        return Response.json({ output: { audio: { url: "https://audio.example/test.wav" } } });
      }
      return new Response(Buffer.from("RIFFtest"), { headers: { "content-type": "audio/wav" } });
    }) as any;

    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "stelle-qwen-tts-"));
    const provider = new DashScopeTtsProvider({
      apiKey: "test-key",
      baseUrl: "https://dashscope.aliyuncs.com/api/v1",
      model: "qwen3-tts-instruct-flash",
      voiceName: "Cherry",
      languageType: "Chinese",
      instructions: "像虚拟主播",
      outputDir,
    });

    const artifacts = await provider.synthesizeToFiles("你好，我是 Stelle。", { filePrefix: "live" });

    expect(calls[0]?.body).toMatchObject({
      model: "qwen3-tts-instruct-flash",
      input: {
        text: "你好，我是 Stelle。",
        voice: "Cherry",
        language_type: "Chinese",
        instructions: "像虚拟主播",
      },
    });
    expect(calls[1]?.url).toBe("https://audio.example/test.wav");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.mimeType).toBe("audio/wav");
    expect(await fs.readFile(artifacts[0]!.path, "utf8")).toBe("RIFFtest");
  });

  it("turns DashScope SSE PCM chunks into a playable wav response", async () => {
    process.env.DASHSCOPE_API_KEY = "test-key";
    process.env.QWEN_TTS_SAMPLE_RATE = "24000";
    const first = Buffer.from([1, 0, 2, 0]).toString("base64");
    const second = Buffer.from([3, 0, 4, 0]).toString("base64");
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          [
            `data: ${JSON.stringify({ output: { audio: { data: first } } })}`,
            `data: ${JSON.stringify({ output: { audio: { data: second } } })}`,
            "data: [DONE]",
            "",
          ].join("\n"),
          { headers: { "content-type": "text/event-stream" } },
        ),
    ) as any;

    const response = await fetchLiveTtsAudio("dashscope", {
      model: "qwen3-tts-instruct-flash-realtime",
      input: { text: "流式测试", voice: "Cherry", language_type: "Chinese" },
      parameters: { stream: true },
    });
    const bytes = Buffer.from(await response.arrayBuffer());

    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(36, 40).toString("ascii")).toBe("data");
    expect(bytes.subarray(44)).toEqual(Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]));
  });

  it("routes live audio through the configured dashscope provider", async () => {
    process.env.STELLE_TTS_PROVIDER = "dashscope";
    process.env.QWEN_TTS_LIVE_MODEL = "qwen3-tts-instruct-flash";
    process.env.QWEN_TTS_VOICE = "Cherry";
    process.env.QWEN_TTS_LANGUAGE_TYPE = "Chinese";
    const commands: any[] = [];
    const bridge: LiveRendererBridge = { publish: (command) => commands.push(command) };
    const runtime = new LiveRuntime(undefined as any, bridge);

    const result = await runtime.playTtsStream("大家晚上好呀", { instructions: "句尾略带上扬" });

    expect(result.summary).toContain("dashscope");
    expect(commands[0]).toMatchObject({ type: "audio:status", provider: "dashscope" });
    expect(commands[1]).toMatchObject({
      type: "audio:stream",
      provider: "dashscope",
      request: {
        model: "qwen3-tts-instruct-flash",
        input: {
          text: "大家晚上好呀",
          voice: "Cherry",
          language_type: "Chinese",
          instructions: "句尾略带上扬",
        },
      },
    });
    expect(commands[1].url).toMatch(/^\/tts\/dashscope\/dashscope-/);
  });

  it("builds Kokoro live requests by default", () => {
    delete process.env.STELLE_TTS_PROVIDER;
    const request = buildLiveTtsRequest("本地兜底测试", { voiceName: "zf_xiaobei" });

    expect(request).toEqual({
      provider: "kokoro",
      request: expect.objectContaining({
        model: "kokoro",
        input: "本地兜底测试",
        voice: "zf_xiaobei",
        response_format: "wav",
      }),
    });
  });
});
