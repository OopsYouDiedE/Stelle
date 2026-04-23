import type { ToolDefinition } from "../../agent/types.js";
import { getBrowserCursor } from "../../cursors/browser/index.js";
import { finishBrowserTool } from "./shared.js";

interface BrowserTypeParams {
  text: string;
  selector?: string;
  placeholder?: string;
  timeout_ms?: number;
  press_enter?: boolean;
}

const browserTypeTool: ToolDefinition<BrowserTypeParams> = {
  schema: {
    type: "function",
    function: {
      name: "browser_type",
      description:
        "Type text into an input on the current page by selector or placeholder.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Text to type into the target input.",
          },
          selector: {
            type: "string",
            description: "Optional CSS selector for the target input.",
          },
          placeholder: {
            type: "string",
            description: "Optional placeholder or aria-label text to identify the input.",
          },
          timeout_ms: {
            type: "integer",
            description: "Optional timeout in milliseconds. Default 10000.",
          },
          press_enter: {
            type: "boolean",
            description: "Whether to press Enter after filling the input.",
          },
        },
        required: ["text"],
      },
    },
  },
  async execute({
    text,
    selector,
    placeholder,
    timeout_ms = 10000,
    press_enter = false,
  }, context) {
    const cursor = getBrowserCursor(context);
    const result = await cursor.run({
      id: `browser-type-${Date.now()}`,
      action: {
        type: "type",
        input: {
          text,
          selector,
          placeholder,
          pressEnter: press_enter,
          timeoutMs: timeout_ms,
        },
      },
      createdAt: Date.now(),
    });
    return finishBrowserTool(result);
  },
};

export default browserTypeTool;
