import type {
  ToolContext,
  ToolDefinition,
  ToolExecuteResult,
  ToolSchema,
} from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<any>>();

  register<TParams>(tool: ToolDefinition<TParams>): this {
    this.tools.set(tool.schema.function.name, tool);
    return this;
  }

  getSchemas(): ToolSchema[] {
    return [...this.tools.values()].map((tool) => tool.schema);
  }

  listToolNames(): string[] {
    return [...this.tools.keys()].sort();
  }

  async execute(
    name: string,
    argsJson: string,
    context?: ToolContext
  ): Promise<ToolExecuteResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `[tool error] Unknown tool "${name}". Available tools: ${this.listToolNames().join(", ")}`;
    }

    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
    } catch (error) {
      return `[tool error] Invalid JSON arguments for "${name}": ${(error as Error).message}`;
    }

    try {
      return await tool.execute(parsedArgs, context);
    } catch (error) {
      return `[tool error] "${name}" failed: ${(error as Error).message}`;
    }
  }
}
