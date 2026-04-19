import { ToolRegistry } from "../../agent/registry.js";
import type { ToolDefinition } from "../../agent/types.js";

export function createShowAvailableToolsTool(
  registry: ToolRegistry
): ToolDefinition {
  return {
    schema: {
      type: "function",
      function: {
        name: "show_available_tools",
        description: "List the tools currently available to the assistant.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    execute() {
      return JSON.stringify(
        {
          count: registry.listToolNames().length,
          tools: registry.listToolNames(),
        },
        null,
        2
      );
    },
  };
}
