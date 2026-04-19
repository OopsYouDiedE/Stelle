import type { ToolDefinition } from "../../agent/types.js";
import { getBrowserCursor } from "../../cursors/browser/index.js";

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
      wait: {
        type: "navigation",
        timeoutMs: 15000,
      },
      expect: {
        summary: "Going back should usually change URL or content",
        mode: "one_of",
        conditions: [{ type: "url_changed" }, { type: "content_changed" }],
        onMiss: "report",
      },
      createdAt: Date.now(),
    });
    return JSON.stringify(result, null, 2);
  },
};

export default browserBackTool;
