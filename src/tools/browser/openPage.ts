import type { ToolDefinition } from "../../agent/types.js";
import { getBrowserCursor } from "../../cursors/browser/index.js";

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
      wait: {
        type: "network_idle",
        timeoutMs: 10000,
      },
      expect: {
        summary: "Opening a page should usually change URL or content",
        mode: "one_of",
        conditions: [{ type: "url_changed" }, { type: "content_changed" }],
        onMiss: "report",
      },
      createdAt: Date.now(),
    });
    return JSON.stringify(result, null, 2);
  },
};

export default browserOpenTool;
