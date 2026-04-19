import type { ToolDefinition } from "../../agent/types.js";

type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

interface TodoParams {
  todos?: TodoItem[];
}

const stores = new Map<string, TodoItem[]>();

const todoTool: ToolDefinition<TodoParams> = {
  schema: {
    type: "function",
    function: {
      name: "todo",
      description: "Read or replace the current conversation todo list for multi-step work.",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            description: "Full todo list replacement. Omit to read the current list.",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                content: { type: "string" },
                status: {
                  type: "string",
                  enum: ["pending", "in_progress", "completed", "cancelled"],
                },
              },
              required: ["id", "content", "status"],
            },
          },
        },
      },
    },
  },
  execute({ todos }, context) {
    const key = context?.conversationId ?? "default";
    if (todos) {
      stores.set(key, todos);
    }
    return JSON.stringify(stores.get(key) ?? [], null, 2);
  },
};

export default todoTool;
