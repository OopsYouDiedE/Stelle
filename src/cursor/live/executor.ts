import type { CursorContext } from "../types.js";
import type { LiveBatchDecision, LiveToolResultView } from "./types.js";
import { CURSOR_CAPABILITIES } from "../capabilities.js";

/**
 * 模块：Live Executor (执行层)
 * 职责：执行直播决策中的工具调用，处理舞台动作。
 */
export class LiveExecutor {
  constructor(private readonly context: CursorContext, private readonly cursorId: string) {}

  public async execute(decision: LiveBatchDecision): Promise<LiveToolResultView[]> {
    if (!decision.toolPlan || !decision.toolPlan.calls.length) return [];

    const results: LiveToolResultView[] = [];
    for (const call of decision.toolPlan.calls.slice(0, 3)) {
      const refinedParams = this.refineParameters(call.tool, call.parameters);
      try {
        const result = await this.context.tools.execute(call.tool, refinedParams, {
          caller: "cursor",
          cursorId: this.cursorId,
          cwd: process.cwd(),
          allowedAuthority: ["readonly", "network_read", "external_write"],
          allowedTools: [...CURSOR_CAPABILITIES.live.executeTools]
        });

        results.push({ name: call.tool, ok: result.ok, summary: result.summary, data: result.data });
      } catch (e) {
        results.push({ name: call.tool, ok: false, summary: String(e) });
      }
    }
    return results;
  }

  /**
   * 参数补全：注入直播相关的 Scope
   */
  private refineParameters(name: string, params: Record<string, unknown>): Record<string, unknown> {
    const refined = { ...params };
    if ((name === "memory.read_recent" || name === "memory.search") && !refined.scope) {
      refined.scope = { kind: "live" };
    }
    return refined;
  }
}
