import type { ToolDefinition } from "../../agent/types.js";

interface CalculatorParams {
  expression: string;
}

const SAFE_EXPR = /^[0-9+\-*/().,%\s]+$/;

const calculatorTool: ToolDefinition<CalculatorParams> = {
  schema: {
    type: "function",
    function: {
      name: "calculate",
      description: "Evaluate a basic arithmetic expression.",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "Arithmetic expression using numbers, parentheses, +, -, *, /, %, and decimal points.",
          },
        },
        required: ["expression"],
      },
    },
  },
  execute({ expression }) {
    if (!expression || !SAFE_EXPR.test(expression)) {
      return "[tool error] Unsupported expression. Only basic arithmetic is allowed.";
    }

    try {
      const value = Function(`"use strict"; return (${expression});`)() as number;
      if (!Number.isFinite(value)) {
        return "[tool error] Expression did not produce a finite number.";
      }
      return String(value);
    } catch (error) {
      return `[tool error] Failed to evaluate expression: ${(error as Error).message}`;
    }
  },
};

export default calculatorTool;
