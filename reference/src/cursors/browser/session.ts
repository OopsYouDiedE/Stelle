import { mkdir } from "node:fs/promises";
import path from "node:path";

type PlaywrightModule = typeof import("playwright");

interface BrowserSessionState {
  playwright: PlaywrightModule;
  browser?: any;
  context: any;
  page: any;
  mode: "playwright" | "cdp";
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
  const mode = (process.env.BROWSER_MODE ?? "playwright").toLowerCase();
  if (mode === "cdp") {
    const cdpUrl = process.env.BROWSER_CDP_URL ?? "http://127.0.0.1:9222";
    const browser = await playwright.chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page =
      context
        .pages()
        .find((candidate: any) => !candidate.url().startsWith("devtools://")) ??
      (await context.newPage());
    return { playwright, browser, context, page, mode: "cdp" };
  }

  const userDataDir =
    process.env.BROWSER_PROFILE_DIR ??
    path.resolve(process.cwd(), "artifacts", "browser", "profile");
  await mkdir(userDataDir, { recursive: true });
  const context = await playwright.chromium.launchPersistentContext(userDataDir, {
    headless: process.env.BROWSER_HEADLESS === "true",
    viewport: { width: 1440, height: 960 },
    args: ["--start-maximized"],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  if (page.url() === "about:blank") {
    await page.setContent(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Stelle Browser Cursor Ready</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: "Segoe UI", sans-serif;
      color: #eaf2ff;
      background:
        radial-gradient(circle at 20% 20%, rgba(255, 155, 106, 0.34), transparent 34%),
        radial-gradient(circle at 80% 0%, rgba(124, 199, 255, 0.28), transparent 36%),
        linear-gradient(135deg, #101821, #0b1118);
    }
    main {
      width: min(760px, calc(100vw - 48px));
      border: 1px solid rgba(180, 200, 220, 0.24);
      border-radius: 28px;
      padding: 34px;
      background: rgba(6, 12, 18, 0.58);
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
    }
    h1 { margin: 0 0 12px; font-size: 34px; }
    p { margin: 0; color: #aab9c8; line-height: 1.6; }
    code { color: #ffd39a; }
  </style>
</head>
<body>
  <main>
    <h1>Stelle Browser Cursor Ready</h1>
    <p>This is the internal Playwright page. Send <code>open https://example.com</code> or another Browser Cursor command to navigate.</p>
  </main>
</body>
</html>`);
  }
  return { playwright, context, page, mode: "playwright" };
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

export async function getBrowserContext(): Promise<any> {
  const session = await getBrowserSession();
  return session.context;
}

export async function setBrowserPage(page: any): Promise<void> {
  const session = await getBrowserSession();
  session.page = page;
}

export async function ensureBrowserScreenshotDir(cwd: string): Promise<string> {
  const dir = path.resolve(cwd, "artifacts", "browser");
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function closeBrowserSession(): Promise<void> {
  if (!globalSession) return;
  const session = await globalSession;
  if (session.mode === "cdp") {
    await session.browser?.disconnect?.();
  } else {
    await session.context.close();
  }
  globalSession = null;
}
