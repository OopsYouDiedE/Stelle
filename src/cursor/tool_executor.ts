import { asRecord } from "../utils/json.js";
import type { ToolAuthority, ToolContext, ToolError, ToolRegistry } from "../tool.js";

// === Types ===
export interface CursorToolCall {
  tool: string;
  parameters: Record<string, unknown>;
}

export interface CursorToolResultView {
  name: string;
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
  error?: ToolError;
}

export interface CursorToolExecutorOptions {
  tools: ToolRegistry;
  cursorId: string;
  allowedTools: readonly string[];
  allowedAuthority: ToolAuthority[];
  cwd?: string;
}

export interface ExecuteToolPlanOptions {
  parallel?: boolean;
  maxCalls?: number;
  maxResults?: number;
  cascadeSearchRead?: boolean;
}

// === Executor ===
export class CursorToolExecutor {
  constructor(private readonly options: CursorToolExecutorOptions) {}

  async executePlan(calls: CursorToolCall[], plan: ExecuteToolPlanOptions = {}): Promise<CursorToolResultView[]> {
    const selected = calls.slice(0, plan.maxCalls ?? 3);
    if (plan.parallel) {
      const results = await Promise.all(selected.map((call) => this.executeSingle(call.tool, call.parameters, plan)));
      return results.flat().slice(0, plan.maxResults ?? 5);
    }

    const results: CursorToolResultView[] = [];
    for (const call of selected) {
      results.push(...(await this.executeSingle(call.tool, call.parameters, plan)));
      if (results.length >= (plan.maxResults ?? Number.POSITIVE_INFINITY)) break;
    }
    return results.slice(0, plan.maxResults ?? results.length);
  }

  async executeSingle(
    name: string,
    input: Record<string, unknown>,
    plan: Pick<ExecuteToolPlanOptions, "cascadeSearchRead"> = {},
  ): Promise<CursorToolResultView[]> {
    try {
      const result = await this.options.tools.execute(name, input, this.toolContext());
      const view: CursorToolResultView = {
        name,
        ok: result.ok,
        summary: result.summary,
        data: result.data,
        error: result.error,
      };
      if (plan.cascadeSearchRead && name === "search.web_search" && result.ok) {
        const url = this.firstSearchResultUrl(view);
        if (url) {
          const read = await this.executeSingle("search.web_read", { url, max_chars: 3000 });
          return [view, ...read];
        }
      }
      return [view];
    } catch (error) {
      return [{ name, ok: false, summary: String(error) }];
    }
  }

  // === Internal Helpers ===
  private firstSearchResultUrl(result: CursorToolResultView): string | null {
    const results = asRecord(result.data).results;
    return Array.isArray(results) && results[0] ? String(asRecord(results[0]).url) : null;
  }

  private toolContext(): ToolContext {
    return {
      caller: "cursor",
      cursorId: this.options.cursorId,
      cwd: this.options.cwd ?? process.cwd(),
      allowedAuthority: this.options.allowedAuthority,
      allowedTools: [...this.options.allowedTools],
    };
  }
}
