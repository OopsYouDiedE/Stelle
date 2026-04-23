import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

import { HttpLiveRendererBridge, LiveRendererServer, LiveRuntime, Live2DModelRegistry } from "../index.js";

test("LiveRendererServer serves OBS browser source page and accepts commands", async () => {
  const server = new LiveRendererServer({ port: 0 });
  const url = await server.start();
  try {
    const pageResponse = await fetch(`${url}/live`);
    assert.equal(pageResponse.ok, true);
    assert.match(await pageResponse.text(), /Stelle Live/);

    const commandResponse = await fetch(`${url}/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "caption:set", text: "Renderer command test" }),
    });
    assert.equal(commandResponse.ok, true);

    const stateResponse = await fetch(`${url}/state`);
    const state = (await stateResponse.json()) as { state: { caption?: string } };
    assert.equal(state.state.caption, "Renderer command test");
  } finally {
    await server.stop();
  }
});

test("LiveRuntime bridge updates renderer state", async () => {
  const server = new LiveRendererServer({ port: 0 });
  await server.start();
  try {
    const runtime = new LiveRuntime(new Live2DModelRegistry(), undefined as never, server);
    await runtime.setCaption("Runtime bridge caption");
    await runtime.setBackground("linear-gradient(90deg, #123, #456)");
    await runtime.setMouth(0.7);
    await runtime.startSpeech(100);
    const state = server.getState();
    assert.equal(state.caption, "Runtime bridge caption");
    assert.match(state.background ?? "", /linear-gradient/);
  } finally {
    await server.stop();
  }
});

test("HttpLiveRendererBridge sends runtime commands to an external renderer service", async () => {
  const server = new LiveRendererServer({ port: 0 });
  const url = await server.start();
  try {
    const bridge = new HttpLiveRendererBridge(url);
    await bridge.publish({ type: "caption:set", text: "HTTP bridge caption" });
    assert.equal(server.getState().caption, "HTTP bridge caption");
    assert.equal(bridge.lastError, undefined);
  } finally {
    await server.stop();
  }
});

test("Live renderer page renders nonblank OBS layout with caption", async () => {
  const server = new LiveRendererServer({ port: 0 });
  const url = await server.start();
  const browser = await chromium.launch({ headless: true });
  try {
    await fetch(`${url}/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "caption:set", text: "OBS browser source caption" }),
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${url}/live`);
    await page.waitForSelector("#caption-text");
    await page.waitForTimeout(300);
    const caption = await page.locator("#caption-text").textContent();
    const modelBox = await page.locator("#live2d-canvas").boundingBox();
    const screenshot = await page.screenshot();

    assert.equal(caption, "OBS browser source caption");
    assert.ok(modelBox && modelBox.width > 900 && modelBox.height > 500);
    assert.equal(screenshot.length > 10_000, true);
  } finally {
    await browser.close();
    await server.stop();
  }
});

test("Live renderer receives audio chunks and starts playback", async () => {
  const server = new LiveRendererServer({ port: 0 });
  const url = await server.start();
  const browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    await page.goto(`${url}/live`);
    await page.waitForFunction(() => Boolean((window as typeof window & { __stelleAudioState?: unknown }).__stelleAudioState));
    await page.waitForFunction(() => Boolean((window as typeof window & { __stelleRendererEventsReady?: boolean }).__stelleRendererEventsReady));

    const audioUrl = createSilentWavDataUrl();
    const commandResponse = await fetch(`${url}/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "audio:play", url: audioUrl, text: "音频片段播放测试" }),
    });
    assert.equal(commandResponse.ok, true);

    await page.waitForFunction(() => {
      const state = (window as typeof window & {
        __stelleAudioState?: { playing: boolean; playedCount: number; lastUrl?: string; lastError?: string };
      }).__stelleAudioState;
      return Boolean(state?.playing || state?.playedCount || state?.lastUrl?.startsWith("data:audio/wav"));
    });
    const state = await page.evaluate(() => (window as typeof window & {
      __stelleAudioState?: { playing: boolean; playedCount: number; lastUrl?: string; lastError?: string };
    }).__stelleAudioState);
    const caption = await page.locator("#caption-text").textContent();

    assert.match(state?.lastUrl ?? "", /^data:audio\/wav/);
    assert.equal(state?.lastError, undefined);
    assert.equal(caption, "音频片段播放测试");
  } finally {
    await browser.close();
    await server.stop();
  }
});

function createSilentWavDataUrl(): string {
  const sampleRate = 8000;
  const seconds = 0.25;
  const samples = Math.round(sampleRate * seconds);
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return `data:audio/wav;base64,${buffer.toString("base64")}`;
}
