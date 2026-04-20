import type { ToolDefinition } from "../../agent/types.js";
import { getBrowserCursor } from "../../cursors/browser/index.js";

interface BrowserClickParams {
  text?: string;
  selector?: string;
  timeout_ms?: number;
}

const browserClickTool: ToolDefinition<BrowserClickParams> = {
  schema: {
    type: "function",
    function: {
      name: "browser_click",
      description:
        "Click an element on the current page by CSS selector or visible text.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Visible text to match on a button, link, or other clickable element.",
          },
          selector: {
            type: "string",
            description: "CSS selector for the element to click.",
          },
          timeout_ms: {
            type: "integer",
            description: "Optional click timeout in milliseconds. Default 10000.",
          },
        },
      },
    },
  },
  async execute({ text, selector, timeout_ms = 10000 }, context) {
    if (!text && !selector) {
      return '[tool error] browser_click requires either "text" or "selector".';
    }

    const cursor = getBrowserCursor(context);
    const result = await cursor.run({
      id: `browser-click-${Date.now()}`,
      action: {
        type: "click",
        input: {
          text,
          selector,
          timeoutMs: timeout_ms,
        },
      },
      createdAt: Date.now(),
    });
    return JSON.stringify(result, null, 2);
  },
};

export default browserClickTool;
