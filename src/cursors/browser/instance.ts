import type { ToolContext } from "../../agent/types.js";
import { stelleMainLoop } from "../../core/runtime.js";
import { PlaywrightBrowserCursor } from "./BrowserCursor.js";
import { playwrightBrowserRuntime } from "./runtime.js";

let browserCursorSingleton: PlaywrightBrowserCursor | null = null;

export function getBrowserCursor(context?: ToolContext): PlaywrightBrowserCursor {
  if (!browserCursorSingleton) {
    browserCursorSingleton = new PlaywrightBrowserCursor({
      id: "browser-main",
      cwd: context?.cwd ?? process.cwd(),
      runtime: playwrightBrowserRuntime,
      uploadAttachment: context?.sendDiscordAttachment,
    });
    stelleMainLoop.registerCursor(browserCursorSingleton);
  } else {
    browserCursorSingleton.configureRuntime({
      cwd: context?.cwd ?? process.cwd(),
      uploadAttachment: context?.sendDiscordAttachment,
    });
  }

  return browserCursorSingleton;
}
