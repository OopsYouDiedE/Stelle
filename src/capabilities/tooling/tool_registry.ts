import { z } from "zod";
import { safeErrorMessage } from "../../shared/json.js";
import { fail } from "./types.js";
import type { ToolContext, ToolDefinition, ToolAuditRecord, ToolResult } from "./types.js";

const STAGE_OWNED_LIVE_TOOLS = new Set([
  "live.set_caption",
  "live.stream_caption",
  "live.stream_tts_caption",
  "live.panel.push_event",
  "live.trigger_motion",
  "live.set_expression",
  "live.stop_output",
]);

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  readonly audit: ToolAuditRecord[] = [];

  register<TSchema extends z.AnyZodObject>(tool: ToolDefinition<TSchema>): void {
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  async execute(name: string, input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return fail("tool_not_found", `Tool is not registered: ${name}.`);

    const startedAt = Date.now();
    let result: ToolResult;
    try {
      const authError = this.checkAuthority(tool, context) ?? this.checkToolWhitelist(tool, context);
      if (authError) {
        result = authError;
      } else {
        const parseResult = tool.inputSchema.safeParse(input);
        if (!parseResult.success) {
          result = fail(
            "invalid_input",
            `Input validation failed: ${parseResult.error.errors.map((e) => e.message).join("; ")}`,
          );
        } else {
          result = await tool.execute(parseResult.data, context);
        }
      }
    } catch (error) {
      result = fail("tool_execution_failed", safeErrorMessage(error));
    }
    const finishedAt = Date.now();

    this.audit.push({
      id: `audit-${startedAt}-${Math.random().toString(36).slice(2)}`,
      toolName: name,
      caller: context.caller,
      cursorId: context.cursorId,
      authority: tool.authority,
      inputSummary: Object.keys(input).join(", ") || "empty",
      resultSummary: result.summary,
      ok: result.ok,
      startedAt,
      finishedAt,
      sideEffects: result.sideEffects ?? [],
    });

    return result;
  }

  private checkAuthority(tool: ToolDefinition, context: ToolContext): ToolResult | undefined {
    if (context.allowedAuthority.includes(tool.authority)) return undefined;
    return fail("authority_denied", `Caller ${context.caller} cannot use ${tool.authority} tool ${tool.name}.`);
  }

  private checkToolWhitelist(tool: ToolDefinition, context: ToolContext): ToolResult | undefined {
    if (context.caller !== "stage_renderer" && STAGE_OWNED_LIVE_TOOLS.has(tool.name)) {
      if (context.caller === "debug" && context.debugBypassStageOutput) {
        // Allow debug bypass.
      } else {
        return fail(
          "stage_output_required",
          `Caller ${context.caller} must submit a stage output intent/proposal instead of calling ${tool.name} directly.`,
        );
      }
    }

    if (!context.allowedTools || context.allowedTools.length === 0) {
      return context.caller === "cursor" || context.caller === "core"
        ? fail("tool_not_whitelisted", `Caller ${context.caller} must provide a tool whitelist for ${tool.name}.`)
        : undefined;
    }
    return context.allowedTools.includes(tool.name)
      ? undefined
      : fail("tool_not_whitelisted", `Tool ${tool.name} is not whitelisted for caller ${context.caller}.`);
  }
}
