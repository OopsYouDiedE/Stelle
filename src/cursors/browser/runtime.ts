import {
  ensureBrowserScreenshotDir,
  getBrowserPage,
  getBrowserSession,
} from "./session.js";

export interface BrowserRuntime {
  ensureReady(): Promise<void>;
  getPage(): Promise<any>;
  getCurrentUrl(): Promise<string | null>;
  getTitle(): Promise<string | null>;
  ensureScreenshotDir(cwd: string): Promise<string>;
}

export const playwrightBrowserRuntime: BrowserRuntime = {
  async ensureReady(): Promise<void> {
    await getBrowserSession();
  },
  async getPage(): Promise<any> {
    return getBrowserPage();
  },
  async getCurrentUrl(): Promise<string | null> {
    const page = await getBrowserPage();
    return page?.url?.() ?? null;
  },
  async getTitle(): Promise<string | null> {
    const page = await getBrowserPage();
    return (await page?.title?.().catch(() => null)) ?? null;
  },
  async ensureScreenshotDir(cwd: string): Promise<string> {
    return ensureBrowserScreenshotDir(cwd);
  },
};
