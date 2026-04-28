import { asRecord } from "../../utils/json.js";
import { CURSOR_CAPABILITIES } from "../capabilities.js";
import type { ToolContext } from "../../tool.js";
import type { CursorContext } from "../types.js";
import type { DiscordReplyPolicy, DiscordToolResultView } from "./types.js";

/**
 * 模块：DiscordToolExecutor (执行层)
 * 职责：权限映射、工具链并发执行、参数自动补全(Scope Injection)。
 */
export class DiscordToolExecutor {
  constructor(private readonly context: CursorContext, private readonly cursorId: string) {}

  public async execute(
    policy: DiscordReplyPolicy, 
    trustLevel: string, 
    discordCtx: { channelId: string; guildId?: string | null; authorId: string }
  ): Promise<DiscordToolResultView[]> {
    if (!policy.toolPlan || !policy.toolPlan.calls.length) return [];
    
    const calls = policy.toolPlan.calls.slice(0, 3);
    const allowedAuthority = this.getTrustAuthority(trustLevel);

    // 预处理：自动补全参数 (例如为记忆工具注入当前频道 Scope)
    const refinedCalls = calls.map(call => ({
      ...call,
      parameters: this.refineParameters(call.tool, call.parameters, discordCtx)
    }));

    if (policy.toolPlan.parallel) {
      const results = await Promise.all(refinedCalls.map(call => this.executeSingle(call.tool, call.parameters, allowedAuthority)));
      return results.flat().slice(0, 5);
    } else {
      const results: DiscordToolResultView[] = [];
      for (const call of refinedCalls) {
        results.push(...(await this.executeSingle(call.tool, call.parameters, allowedAuthority)));
      }
      return results;
    }
  }

  /**
   * 核心逻辑：参数自动补全
   * 防止 LLM 遗漏或填错底层的 scope、channelId 等字段
   */
  private refineParameters(name: string, params: Record<string, unknown>, ctx: { channelId: string; guildId?: string | null; authorId: string }): Record<string, unknown> {
    const refined = { ...params };

    // 1. 为记忆读取工具注入当前频道 Scope
    if ((name === "memory.read_recent" || name === "memory.search") && !refined.scope) {
      refined.scope = {
        kind: "discord_channel",
        channelId: ctx.channelId,
        guildId: ctx.guildId || null
      };
    }

    // 2. 为 Discord 消息读取注入当前频道 (如果未指定)
    if (name === "discord.get_channel_history" && !refined.channel_id) {
      refined.channel_id = ctx.channelId;
    }

    return refined;
  }

  private async executeSingle(name: string, input: Record<string, unknown>, authority: ToolContext["allowedAuthority"]): Promise<DiscordToolResultView[]> {
    try {
      const result = await this.context.tools.execute(name, input, this.toolContext(authority));
      const view: DiscordToolResultView = {
        name,
        ok: result.ok,
        summary: result.summary,
        data: result.data,
        error: result.error // 保留错误详情
      };
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
    return { caller: "cursor", cursorId: this.cursorId, cwd: process.cwd(), allowedAuthority, allowedTools: [...CURSOR_CAPABILITIES.discord.executeTools] };
  }
}
