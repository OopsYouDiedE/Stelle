import type { ToolDefinition } from "../../agent/types.js";
import { getBrowserCursor } from "../../cursors/browser/index.js";
import { finishBrowserTool } from "./shared.js";

interface BrowserReadPageParams {
  max_items?: number;
}

const browserReadPageTool: ToolDefinition<BrowserReadPageParams> = {
  schema: {
    type: "function",
    function: {
      name: "browser_read_page",
      description:
        "Read the current webpage and return title, URL, visible text summary, links, buttons, and inputs.",
      parameters: {
        type: "object",
        properties: {
          max_items: {
            type: "integer",
            description: "Maximum number of links, buttons, and inputs to return. Default 12.",
          },
        },
      },
    },
  },
  async execute({ max_items = 12 }, context) {
    const cursor = getBrowserCursor(context);
    const result = await cursor.run({
      id: `browser-read-${Date.now()}`,
      action: {
        type: "inspect_interactive",
        input: { maxItems: max_items },
      },
      createdAt: Date.now(),
    });
    return finishBrowserTool(result);
  },
};

export default browserReadPageTool;
