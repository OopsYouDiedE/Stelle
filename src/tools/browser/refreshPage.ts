import type { ToolDefinition } from "../../agent/types.js";
import { getBrowserCursor } from "../../cursors/browser/index.js";

const browserRefreshTool: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "browser_refresh",
      description: "Reload the current browser page.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  async execute(_params, context) {
    const cursor = getBrowserCursor(context);
    const result = await cursor.run({
      id: `browser-refresh-${Date.now()}`,
      action: {
        type: "refresh",
      },
      createdAt: Date.now(),
    });
    return JSON.stringify(result, null, 2);
  },
};

export default browserRefreshTool;
