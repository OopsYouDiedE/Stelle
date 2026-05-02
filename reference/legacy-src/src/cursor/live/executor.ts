// === Imports ===
import { CURSOR_CAPABILITIES } from "../capabilities.js";
import type { CursorContext } from "../types.js";
import { CursorToolExecutor, type CursorToolCall } from "../tool_executor.js";
import type { LiveBatchDecision, LiveToolResultView } from "./types.js";

/**
 * 模块：Live Executor (执行层)
 * 职责：执行直播决策中的工具调用，处理直播专属参数补全。
 */
// === Class Definition ===
export class LiveExecutor {
  constructor(
    private readonly context: CursorContext,
    private readonly cursorId: string,
  ) {}

  // === Tool Execution ===
  public async execute(decision: LiveBatchDecision): Promise<LiveToolResultView[]> {
    if (!decision.toolPlan || !decision.toolPlan.calls.length) return [];

    const calls: CursorToolCall[] = decision.toolPlan.calls.map((call) => ({
      ...call,
      parameters: this.refineParameters(call.tool, call.parameters),
    }));
    const executor = new CursorToolExecutor({
      tools: this.context.tools,
      cursorId: this.cursorId,
      allowedAuthority: ["readonly", "network_read", "external_write"],
      allowedTools: CURSOR_CAPABILITIES.live.executeTools,
    });

    return executor.executePlan(calls, {
      maxCalls: 3,
      cascadeSearchRead: false,
    }) as Promise<LiveToolResultView[]>;
  }

  // === Parameter Refinement ===
  private refineParameters(name: string, params: Record<string, unknown>): Record<string, unknown> {
    const refined = { ...params };
    if ((name === "memory.read_recent" || name === "memory.search") && !refined.scope) {
      refined.scope = { kind: "live" };
    }
    return refined;
  }
}
