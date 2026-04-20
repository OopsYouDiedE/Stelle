import {
  ensureBrowserScreenshotDir,
  getBrowserContext,
  getBrowserPage,
  getBrowserSession,
  setBrowserPage,
} from "./session.js";

export interface BrowserRuntime {
  ensureReady(): Promise<void>;
  getPage(): Promise<any>;
  getContext(): Promise<any>;
  setPage(page: any): Promise<void>;
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
  async getContext(): Promise<any> {
    return getBrowserContext();
  },
  async setPage(page: any): Promise<void> {
    await setBrowserPage(page);
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
