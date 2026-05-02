import { z } from "zod";
import { safeErrorMessage } from "../utils/json.js";
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

export interface ToolBudgetPolicy {
  windowMs: number;
  maxCalls: number;
  failureThreshold: number;
  circuitOpenMs: number;
}

export interface ToolRegistryOptions {
  budgets?: Record<string, Partial<ToolBudgetPolicy>>;
}

export interface ToolHealthStatus {
  toolName: string;
  recentCalls: number;
  consecutiveFailures: number;
  circuitOpenUntil?: number;
}

interface ToolHealthState {
  calls: number[];
  consecutiveFailures: number;
  circuitOpenUntil?: number;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly health = new Map<string, ToolHealthState>();
  readonly audit: ToolAuditRecord[] = [];

  constructor(private readonly options: ToolRegistryOptions = {}) {}

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
        const budgetError = this.checkBudget(tool, startedAt);
        if (budgetError) {
          result = budgetError;
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
          this.recordToolOutcome(tool, result, startedAt);
        }
      }
    } catch (error) {
      result = fail("tool_execution_failed", safeErrorMessage(error));
      this.recordToolOutcome(tool, result, startedAt);
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

  getHealth(): ToolHealthStatus[] {
    const now = Date.now();
    return [...this.tools.values()].map((tool) => {
      const policy = this.policyFor(tool);
      const state = this.stateFor(tool.name);
      this.pruneCalls(state, policy, now);
      return {
        toolName: tool.name,
        recentCalls: state.calls.length,
        consecutiveFailures: state.consecutiveFailures,
        circuitOpenUntil: state.circuitOpenUntil && state.circuitOpenUntil > now ? state.circuitOpenUntil : undefined,
      };
    });
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
          `Caller ${context.caller} must submit OutputIntent to StageOutputArbiter instead of calling ${tool.name} directly.`,
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

  private checkBudget(tool: ToolDefinition, now: number): ToolResult | undefined {
    const policy = this.policyFor(tool);
    const state = this.stateFor(tool.name);
    this.pruneCalls(state, policy, now);

    if (state.circuitOpenUntil && state.circuitOpenUntil > now) {
      return fail("tool_circuit_open", `Tool ${tool.name} circuit is open until ${state.circuitOpenUntil}.`, true);
    }

    if (state.calls.length >= policy.maxCalls) {
      return fail("tool_rate_limited", `Tool ${tool.name} exceeded ${policy.maxCalls} calls per ${policy.windowMs}ms.`, true);
    }

    state.calls.push(now);
    return undefined;
  }

  private recordToolOutcome(tool: ToolDefinition, result: ToolResult, now: number): void {
    const policy = this.policyFor(tool);
    const state = this.stateFor(tool.name);
    if (result.ok) {
      state.consecutiveFailures = 0;
      return;
    }
    if (result.error?.code === "tool_rate_limited" || result.error?.code === "tool_circuit_open") return;
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= policy.failureThreshold) {
      state.circuitOpenUntil = now + policy.circuitOpenMs;
    }
  }

  private stateFor(toolName: string): ToolHealthState {
    const current = this.health.get(toolName);
    if (current) return current;
    const state: ToolHealthState = { calls: [], consecutiveFailures: 0 };
    this.health.set(toolName, state);
    return state;
  }

  private policyFor(tool: ToolDefinition): ToolBudgetPolicy {
    const base: ToolBudgetPolicy =
      tool.authority === "readonly"
        ? { windowMs: 60_000, maxCalls: 120, failureThreshold: 8, circuitOpenMs: 30_000 }
        : tool.authority === "network_read"
          ? { windowMs: 60_000, maxCalls: 20, failureThreshold: 3, circuitOpenMs: 60_000 }
          : tool.authority === "external_write"
            ? { windowMs: 60_000, maxCalls: 12, failureThreshold: 3, circuitOpenMs: 60_000 }
            : { windowMs: 60_000, maxCalls: 40, failureThreshold: 5, circuitOpenMs: 30_000 };
    return { ...base, ...(this.options.budgets?.[tool.name] ?? {}) };
  }

  private pruneCalls(state: ToolHealthState, policy: ToolBudgetPolicy, now: number): void {
    const cutoff = now - policy.windowMs;
    state.calls = state.calls.filter((timestamp) => timestamp >= cutoff);
    if (state.circuitOpenUntil && state.circuitOpenUntil <= now) {
      state.circuitOpenUntil = undefined;
      state.consecutiveFailures = 0;
    }
  }
}
