import type { ToolDefinition } from "../../agent/types.js";
import { getBrowserCursor } from "../../cursors/browser/index.js";
import { finishBrowserTool } from "./shared.js";

interface BrowserOpenParams {
  url: string;
}

const browserOpenTool: ToolDefinition<BrowserOpenParams> = {
  schema: {
    type: "function",
    function: {
      name: "browser_open",
      description: "Open a webpage in the shared browser session.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Absolute URL to open, including protocol.",
          },
        },
        required: ["url"],
      },
    },
  },
  async execute({ url }, context) {
    const cursor = getBrowserCursor(context);
    const result = await cursor.run({
      id: `browser-open-${Date.now()}`,
      action: {
        type: "open",
        input: { url },
      },
      createdAt: Date.now(),
    });
    return finishBrowserTool(result);
  },
};

export default browserOpenTool;
