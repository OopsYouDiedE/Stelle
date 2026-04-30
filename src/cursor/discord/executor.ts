import { CURSOR_CAPABILITIES } from "../capabilities.js";
import type { ToolAuthority } from "../../tool.js";
import type { CursorContext } from "../types.js";
import { CursorToolExecutor, type CursorToolCall } from "../tool_executor.js";
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
    discordCtx: { channelId: string; guildId?: string | null; authorId: string },
  ): Promise<DiscordToolResultView[]> {
    if (!policy.toolPlan || !policy.toolPlan.calls.length) return [];

    const allowedAuthority = this.getTrustAuthority(trustLevel);
    const refinedCalls: CursorToolCall[] = policy.toolPlan.calls.map(call => ({
      ...call,
      parameters: this.refineParameters(call.tool, call.parameters, discordCtx),
    }));
    const executor = new CursorToolExecutor({
      tools: this.context.tools,
      cursorId: this.cursorId,
      allowedAuthority,
      allowedTools: CURSOR_CAPABILITIES.discord.executeTools,
    });

    return executor.executePlan(refinedCalls, {
      parallel: policy.toolPlan.parallel,
      maxCalls: 3,
      maxResults: 5,
      cascadeSearchRead: true,
    }) as Promise<DiscordToolResultView[]>;
  }

  private refineParameters(
    name: string,
    params: Record<string, unknown>,
    ctx: { channelId: string; guildId?: string | null; authorId: string },
  ): Record<string, unknown> {
    const refined = { ...params };

    if ((name === "memory.read_recent" || name === "memory.search") && !refined.scope) {
      refined.scope = {
        kind: "discord_channel",
        channelId: ctx.channelId,
        guildId: ctx.guildId || null,
      };
    }

    if (name === "discord.get_channel_history" && !refined.channel_id) {
      refined.channel_id = ctx.channelId;
    }

    return refined;
  }

  private getTrustAuthority(trustLevel: string): ToolAuthority[] {
    switch (trustLevel) {
      case "owner": return ["readonly", "safe_write", "network_read", "external_write"];
      case "bot": return ["readonly", "network_read"];
      default: return ["readonly", "network_read"];
    }
  }
}
