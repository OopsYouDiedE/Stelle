import type { ToolDefinition } from "../../agent/types.js";
import { getBrowserCursor } from "../../cursors/browser/index.js";
import { finishBrowserTool } from "./shared.js";

interface BrowserHumanWaitParams {
  reason?: string;
  timeout_ms?: number;
}

const browserHumanWaitTool: ToolDefinition<BrowserHumanWaitParams> = {
  schema: {
    type: "function",
    function: {
      name: "browser_human_wait",
      description:
        "Pause Browser Cursor for 30-60 seconds so a human can solve login, captcha, permission, or other manual browser steps, then observe the page again.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Why human handoff is needed.",
          },
          timeout_ms: {
            type: "integer",
            description: "Wait duration in milliseconds, clamped to 30000-60000. Default 45000.",
          },
        },
      },
    },
  },
  async execute({ reason, timeout_ms = 45000 }, context) {
    const cursor = getBrowserCursor(context);
    const result = await cursor.run({
      id: `browser-human-wait-${Date.now()}`,
      action: {
        type: "human_wait",
        input: { reason, timeoutMs: timeout_ms },
      },
      createdAt: Date.now(),
    });
    return finishBrowserTool(result);
  },
};

export default browserHumanWaitTool;
