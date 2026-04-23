import type {
  AuthorityClass,
  ToolAuditRecord,
  ToolDefinition,
  ToolExecutionContext,
  ToolIdentity,
  ToolResult,
} from "../types.js";

function fullName(identity: ToolIdentity): string {
  return `${identity.namespace}.${identity.name}`;
}

function fail(code: string, message: string): ToolResult {
  return {
    ok: false,
    summary: message,
    error: { code, message, retryable: false },
  };
}

function errorToResult(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return fail("tool_execution_failed", message);
}

export class MemoryAuditSink {
  readonly records: ToolAuditRecord[] = [];

  record(record: ToolAuditRecord): void {
    this.records.push(record);
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    const key = fullName(tool.identity);
    if (this.tools.has(key)) {
      throw new Error(`Tool already registered: ${key}`);
    }
    this.tools.set(key, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(filter?: { authorityClass?: AuthorityClass }): ToolIdentity[] {
    return [...this.tools.values()]
      .filter((tool) => !filter?.authorityClass || tool.identity.authorityClass === filter.authorityClass)
      .map((tool) => tool.identity);
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return fail("tool_not_found", `Tool is not registered: ${name}`);
    }

    const startedAt = Date.now();
    let result: ToolResult;
    try {
      const authorityFailure = this.checkAuthority(tool, context);
      const schemaFailure = this.checkSchema(tool, input);
      const validationFailure = authorityFailure ?? schemaFailure ?? tool.validate?.(input, context);
      result = validationFailure ?? (await tool.execute(input, context));
    } catch (error) {
      result = errorToResult(error);
    }
    const finishedAt = Date.now();

    await context.audit.record({
      id: `audit-${startedAt}-${Math.random().toString(36).slice(2)}`,
      toolName: tool.identity.name,
      namespace: tool.identity.namespace,
      caller: context.caller,
      cursorId: context.cursorId,
      authorityLevel: tool.authority.level,
      inputSummary: this.summarizeInput(input),
      resultSummary: result.summary,
      sideEffects: result.sideEffects ?? [],
      startedAt,
      finishedAt,
      ok: result.ok,
    });

    return result;
  }

  private checkAuthority(tool: ToolDefinition, context: ToolExecutionContext): ToolResult | undefined {
    if (!context.authority.allowedAuthorityClasses.includes(tool.identity.authorityClass)) {
      return fail(
        "authority_denied",
        `Caller ${context.caller} cannot use ${tool.identity.authorityClass} tool ${fullName(tool.identity)}`
      );
    }
    if (tool.authority.requiresUserConfirmation && !context.authority.confirmed) {
      return fail("confirmation_required", `Tool requires user confirmation: ${fullName(tool.identity)}`);
    }
    return undefined;
  }

  private checkSchema(tool: ToolDefinition, input: Record<string, unknown>): ToolResult | undefined {
    for (const key of tool.inputSchema.required ?? []) {
      if (!(key in input)) {
        return fail("invalid_input", `Missing required field: ${key}`);
      }
    }
    return undefined;
  }

  private summarizeInput(input: Record<string, unknown>): string {
    const keys = Object.keys(input);
    return keys.length ? `fields: ${keys.join(", ")}` : "empty object";
  }
}
