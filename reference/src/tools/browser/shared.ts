import { stelle } from "../../core/runtime.js";
import type { BrowserRunResult } from "../../cursors/browser/index.js";

export function finishBrowserTool(result: BrowserRunResult): string {
  stelle.recordReports(result.reports);
  return JSON.stringify(result, null, 2);
}
