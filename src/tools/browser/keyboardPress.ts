import type { ToolDefinition } from "../../agent/types.js";
import { getBrowserCursor } from "../../cursors/browser/index.js";
import { finishBrowserTool } from "./shared.js";

interface BrowserKeyboardPressParams {
  key: string;
}

const browserKeyboardPressTool: ToolDefinition<BrowserKeyboardPressParams> = {
  schema: {
    type: "function",
    function: {
      name: "browser_keyboard_press",
      description:
        "Press a keyboard key in the shared browser, such as Enter, Escape, Tab, ArrowDown, or Control+A.",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "Playwright keyboard key name, e.g. Enter, Escape, Tab, Control+A.",
          },
        },
        required: ["key"],
      },
    },
  },
  async execute({ key }, context) {
    const cursor = getBrowserCursor(context);
    const result = await cursor.run({
      id: `browser-keyboard-press-${Date.now()}`,
      action: {
        type: "keyboard_press",
        input: { key },
      },
      createdAt: Date.now(),
    });
    return finishBrowserTool(result);
  },
};

export default browserKeyboardPressTool;
