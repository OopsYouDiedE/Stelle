import type { ToolDefinition } from "../../agent/types.js";
import { getBrowserCursor } from "../../cursors/browser/index.js";
import { finishBrowserTool } from "./shared.js";

const browserBackTool: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "browser_back",
      description: "Go back to the previous page in browser history.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  async execute(_params, context) {
    const cursor = getBrowserCursor(context);
    const result = await cursor.run({
      id: `browser-back-${Date.now()}`,
      action: {
        type: "back",
      },
      createdAt: Date.now(),
    });
    return finishBrowserTool(result);
  },
};

export default browserBackTool;
