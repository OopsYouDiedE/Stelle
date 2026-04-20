import type { ToolDefinition } from "../../agent/types.js";
import { getBrowserCursor } from "../../cursors/browser/index.js";
import { finishBrowserTool } from "./shared.js";

interface BrowserScreenshotParams {
  file_name?: string;
  full_page?: boolean;
}

const browserScreenshotTool: ToolDefinition<BrowserScreenshotParams> = {
  schema: {
    type: "function",
    function: {
      name: "browser_screenshot",
      description: "Capture a screenshot of the current browser page and save it locally.",
      parameters: {
        type: "object",
        properties: {
          file_name: {
            type: "string",
            description: "Optional output filename. Defaults to a timestamp-based name.",
          },
          full_page: {
            type: "boolean",
            description: "Whether to capture the full page. Default true.",
          },
        },
      },
    },
  },
  async execute({ file_name, full_page = true }, context) {
    const cursor = getBrowserCursor(context);
    const result = await cursor.run({
      id: `browser-screenshot-${Date.now()}`,
      action: {
        type: "screenshot",
        input: {
          reason: "tool requested screenshot",
          fileName: file_name,
          fullPage: full_page,
        },
      },
      createdAt: Date.now(),
    });
    return finishBrowserTool(result);
  },
};

export default browserScreenshotTool;
