import type { ToolDefinition } from "../../agent/types.js";
import { getBrowserCursor } from "../../cursors/browser/index.js";
import { finishBrowserTool } from "./shared.js";

interface BrowserMouseClickParams {
  x: number;
  y: number;
  button?: "left" | "right" | "middle";
  click_count?: number;
}

const browserMouseClickTool: ToolDefinition<BrowserMouseClickParams> = {
  schema: {
    type: "function",
    function: {
      name: "browser_mouse_click",
      description:
        "Click the shared browser by absolute viewport coordinates. Use for real visual operation when selector clicking is unreliable.",
      parameters: {
        type: "object",
        properties: {
          x: { type: "number", description: "Viewport X coordinate." },
          y: { type: "number", description: "Viewport Y coordinate." },
          button: {
            type: "string",
            enum: ["left", "right", "middle"],
            description: "Mouse button. Default left.",
          },
          click_count: {
            type: "integer",
            description: "Click count. Default 1.",
          },
        },
        required: ["x", "y"],
      },
    },
  },
  async execute({ x, y, button = "left", click_count = 1 }, context) {
    const cursor = getBrowserCursor(context);
    const result = await cursor.run({
      id: `browser-mouse-click-${Date.now()}`,
      action: {
        type: "mouse_click",
        input: { x, y, button, clickCount: click_count },
      },
      createdAt: Date.now(),
    });
    return finishBrowserTool(result);
  },
};

export default browserMouseClickTool;
