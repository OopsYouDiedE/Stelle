import { mkdir } from "node:fs/promises";
import path from "node:path";

type PlaywrightModule = typeof import("playwright");

interface BrowserSessionState {
  playwright: PlaywrightModule;
  browser: any;
  context: any;
  page: any;
}

let globalSession: Promise<BrowserSessionState> | null = null;

async function loadPlaywright(): Promise<PlaywrightModule> {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(
      `Playwright is not available. Install it with "npm install playwright". Details: ${
        (error as Error).message
      }`
    );
  }
}

async function createSession(): Promise<BrowserSessionState> {
  const playwright = await loadPlaywright();
  const browser = await playwright.chromium.launch({
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();
  return { playwright, browser, context, page };
}

export async function getBrowserSession(): Promise<BrowserSessionState> {
  if (!globalSession) {
    globalSession = createSession().catch((error) => {
      globalSession = null;
      throw error;
    });
  }
  return globalSession;
}

export async function getBrowserPage(): Promise<any> {
  const session = await getBrowserSession();
  return session.page;
}

export async function ensureBrowserScreenshotDir(cwd: string): Promise<string> {
  const dir = path.resolve(cwd, "artifacts", "browser");
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function closeBrowserSession(): Promise<void> {
  if (!globalSession) return;
  const session = await globalSession;
  await session.context.close();
  await session.browser.close();
  globalSession = null;
}
