import { asRecord } from "../../utils/json.js";
import type { ToolContext } from "../../tool.js";
import type { CursorContext } from "../types.js";
import type { DiscordReplyPolicy, DiscordToolResultView } from "./types.js";

const DISCORD_CURSOR_TOOLS = [
  "memory.read_recent", "memory.search", "memory.read_long_term", "memory.write_long_term",
  "memory.append_research_log", "search.web_search", "search.web_read",
  "discord.status", "discord.get_channel_history", "discord.reply_message",
  "live.status", "obs.status",
] as const;

/**
 * 模块：DiscordToolExecutor (执行层)
 * 职责：权限映射、工具链并发执行、特殊级联工具逻辑。
 */
export class DiscordToolExecutor {
  constructor(private readonly context: CursorContext, private readonly cursorId: string) {}

  public async execute(policy: DiscordReplyPolicy, trustLevel: string): Promise<DiscordToolResultView[]> {
    if (!policy.toolPlan || !policy.toolPlan.calls.length) return [];
    
    const calls = policy.toolPlan.calls.slice(0, 3); // 限制单次任务规模
    const allowedAuthority = this.getTrustAuthority(trustLevel);

    if (policy.toolPlan.parallel) {
      const results = await Promise.all(calls.map(call => this.executeSingle(call.tool, call.parameters, allowedAuthority)));
      return results.flat().slice(0, 5);
    } else {
      const results: DiscordToolResultView[] = [];
      for (const call of calls) {
        results.push(...(await this.executeSingle(call.tool, call.parameters, allowedAuthority)));
      }
      return results;
    }
  }

  private async executeSingle(name: string, input: Record<string, any>, authority: ToolContext["allowedAuthority"]): Promise<DiscordToolResultView[]> {
    try {
      const result = await this.context.tools.execute(name, input, this.toolContext(authority));
      const view: DiscordToolResultView = { name, ok: result.ok, summary: result.summary, data: result.data as any };

      // 特殊处理：Search 级联读取
      if (name === "search.web_search" && result.ok) {
        const url = this.firstSearchResultUrl(view);
        if (url) {
          const read = await this.executeSingle("search.web_read", { url, max_chars: 3000 }, authority);
          return [view, ...read];
        }
      }
      return [view];
    } catch (e) {
      return [{ name, ok: false, summary: String(e) }];
    }
  }

  private getTrustAuthority(trustLevel: string): ToolContext["allowedAuthority"] {
    switch (trustLevel) {
      case "owner": return ["readonly", "safe_write", "network_read", "external_write"];
      case "bot": return ["readonly", "network_read"];
      default: return ["readonly", "network_read"];
    }
  }

  private firstSearchResultUrl(result: DiscordToolResultView): string | null {
    const results = asRecord(result.data).results;
    return Array.isArray(results) && results[0] ? String(asRecord(results[0]).url) : null;
  }

  private toolContext(allowedAuthority: ToolContext["allowedAuthority"]): ToolContext {
    return { caller: "cursor", cursorId: this.cursorId, cwd: process.cwd(), allowedAuthority, allowedTools: [...DISCORD_CURSOR_TOOLS] };
  }
}
