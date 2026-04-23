export interface JSONSchemaProperty {
  type: "string" | "number" | "boolean" | "integer" | "array" | "object";
  description?: string;
  enum?: string[];
  items?: JSONSchemaProperty | JSONSchemaObject;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface JSONSchemaObject {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JSONSchemaObject;
  };
}

export interface ToolContext {
  conversationId?: string;
  cwd?: string;
  sendDiscordAttachment?: (
    filePath: string,
    caption?: string
  ) => Promise<string | void> | string | void;
}

export type ToolExecuteResult = string;

export interface ToolDefinition<TParams = Record<string, unknown>> {
  schema: ToolSchema;
  execute: (
    params: TParams,
    context?: ToolContext
  ) => Promise<ToolExecuteResult> | ToolExecuteResult;
}

export interface ToolCallTrace {
  name: string;
  args: Record<string, unknown>;
  resultPreview: string;
}

export interface AgentStatusUpdate {
  phase:
    | "start"
    | "round"
    | "tool_start"
    | "tool_end"
    | "done"
    | "error";
  round?: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  resultPreview?: string;
  message?: string;
}

export interface AgentRunResult {
  text: string;
  toolTrace: ToolCallTrace[];
}
