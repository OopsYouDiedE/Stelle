import type { ToolDefinition } from "../../agent/types.js";

const datetimeTool: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "get_current_datetime",
      description: "Get the current local date and time from the runtime environment.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  execute() {
    const now = new Date();
    return JSON.stringify(
      {
        iso: now.toISOString(),
        local: now.toString(),
        timestamp: now.getTime(),
      },
      null,
      2
    );
  },
};

export default datetimeTool;
