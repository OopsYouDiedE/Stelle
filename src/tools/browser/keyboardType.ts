import type { ToolDefinition } from "../../agent/types.js";
import { getBrowserCursor } from "../../cursors/browser/index.js";

interface BrowserKeyboardTypeParams {
  text: string;
  delay_ms?: number;
}

const browserKeyboardTypeTool: ToolDefinition<BrowserKeyboardTypeParams> = {
  schema: {
    type: "function",
    function: {
      name: "browser_keyboard_type",
      description:
        "Type text through the shared browser keyboard into the currently focused element.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Text to type into the focused field or page.",
          },
          delay_ms: {
            type: "integer",
            description: "Delay between keystrokes. Default 20.",
          },
        },
        required: ["text"],
      },
    },
  },
  async execute({ text, delay_ms = 20 }, context) {
    const cursor = getBrowserCursor(context);
    const result = await cursor.run({
      id: `browser-keyboard-type-${Date.now()}`,
      action: {
        type: "keyboard_type",
        input: { text, delayMs: delay_ms },
      },
      createdAt: Date.now(),
    });
    return JSON.stringify(result, null, 2);
  },
};

export default browserKeyboardTypeTool;
