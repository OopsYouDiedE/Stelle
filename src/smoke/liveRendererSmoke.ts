import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { LiveRendererServer } from "../live/renderer/LiveRendererServer.js";

const outputDir = path.resolve("test");
await fs.mkdir(outputDir, { recursive: true });

const server = new LiveRendererServer({ port: 8787 });
const url = await server.start();
const browser = await chromium.launch({ headless: true });

try {
  await fetch(`${url}/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "caption:set",
      text: "这里是 Stelle 当前正在说的话。OBS 可以直接捕获这个页面。",
    }),
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${url}/live`);
  await page.waitForSelector("#caption-text");
  await page.waitForTimeout(2500);
  const canvasPixels = await page.locator("#live2d-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (context) {
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonTransparent = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) nonTransparent++;
      return nonTransparent;
    }
    return canvas.width * canvas.height;
  });
  await page.screenshot({ path: path.join(outputDir, "live-renderer-smoke.png"), fullPage: true });
  await fs.writeFile(
    path.join(outputDir, "live-renderer-smoke.json"),
    JSON.stringify(
      {
        liveUrl: `${url}/live`,
        screenshot: path.join(outputDir, "live-renderer-smoke.png"),
        caption: await page.locator("#caption-text").textContent(),
        status: await page.locator("#status").textContent(),
        canvasPixels,
        consoleMessages,
        pageErrors,
      },
      null,
      2
    ),
    "utf8"
  );
} finally {
  await browser.close();
  await server.stop();
}
