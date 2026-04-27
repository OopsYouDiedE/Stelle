import { asRecord, enumValue } from "../../utils/json.js";
import type { DiscordMessageSummary } from "../../utils/discord.js";
import type { CursorContext } from "../types.js";
import type { DiscordChannelSession, DiscordReplyPolicy, DiscordToolPlan } from "./types.js";

const ALLOWED_POLICY_TOOLS = new Set<string>([
  "memory.read_recent", "memory.search", "memory.read_long_term",
  "discord.status", "discord.get_channel_history", "live.status", 
  "search.web_search", "search.web_read"
]);

/**
 * 模块：DiscordRouter (决策层)
 * 职责：意图识别、响应模式判定、工具链规划。
 */
export class DiscordRouter {
  constructor(private readonly context: CursorContext, private readonly persona: string) {}

  public async designPolicy(
    session: DiscordChannelSession,
    batch: DiscordMessageSummary[],
    isMentioned: boolean,
    activePolicies: any[] = []
  ): Promise<DiscordReplyPolicy> {
    // 默认回退逻辑：没被提到则保持沉默，被提到则简单回复
    const fallback: DiscordReplyPolicy = { 
      mode: isMentioned ? "reply" : "silent", 
      intent: "local_chat", 
      reason: "llm_error_fallback", 
      needsThinking: false 
    };
    if (!this.context.config.models.apiKey) return fallback;

    // 结构化策略先行：如果 InnerMind 强制要求沉默，则直接返回
    if (activePolicies.some(p => p.replyBias === "silent")) {
      return { mode: "silent", intent: "local_chat", reason: "inner_mind_silent_bias", needsThinking: false };
    }

    const batchContent = batch.map(m => `${m.author.username}: ${m.cleanContent}`).join("\n");
    const recentHistory = session.history.slice(-10).map(m => `${m.author.username}: ${m.cleanContent}`).join("\n");
    
    // 构造指令块
    const directiveBlock = activePolicies.length 
      ? `\nCURRENT ACTIVE BEHAVIOR POLICIES:\n${activePolicies.map(p => {
          const parts = [];
          if (p.replyBias) parts.push(`Reply Bias: ${p.replyBias}`);
          if (p.vibeIntensity) parts.push(`Vibe Intensity: ${p.vibeIntensity}/5`);
          if (p.focusTopic) parts.push(`Current Focus: ${p.focusTopic}`);
          if (p.instruction) parts.push(`Instruction: ${p.instruction}`);
          return `- ${parts.join(" | ")}`;
        }).join("\n")}`
      : "";

    try {
      return await this.context.llm.generateJson(
        [
          this.persona,
          "You are the Strategic Social Router. Decision Layer.",
          directiveBlock,
          "Current Session Mode: " + session.mode,
          "Decide whether to REPLY, stay SILENT, or DEACTIVATE.",
          "",
          "Schema:",
          "{",
          '  "mode": "reply|silent|deactivate",',
          '  "intent": "local_chat|live_request|memory_query|memory_write|factual_query|system_status",',
          '  "reason": "short string",',
          '  "needs_thinking": boolean,',
          '  "tool_plan": {',
          '    "calls": [{ "tool": "tool_name", "parameters": {} }],',
          '    "parallel": boolean',
          "  }",
          "}",
          "",
          "Available Tools for Planning:",
          "- memory.read_recent: { scope: { kind: 'discord_channel', channelId: '...' }, limit: 10 } (Quick glance at last few messages)",
          "- memory.search: { scope: { ... }, text: 'query', limit: 3 } (Deep search across ALL history, including very recent context)",
          "- memory.read_long_term: { key: '...' } (Read specific identity/subconscious/facts files)",
          "- discord.status: {}",
          "- discord.get_channel_history: { channel_id: '...', limit: 10 }",
          "- live.status: {}",
          "- search.web_search: { query: '...', count: 2 }",
          "",
          "Rules:",
          "1. ONLY 'reply' mode can have a tool_plan.",
          "2. If the user asks about the past, use memory tools.",
          "3. If the user asks for information you don't have, use search.web_search.",
          `Context: mentioned=${isMentioned}`,
          `Recent context:\n${recentHistory || "(none)"}`,
          `LATEST OBSERVED BATCH:\n${batchContent}`
        ].join("\n"),
        "discord_reply_policy",
        (raw) => {
          const v = asRecord(raw);
          const tp = asRecord(v.tool_plan || v.toolPlan);
          
          let toolPlan: DiscordToolPlan | undefined;
          if (Array.isArray(tp.calls)) {
            toolPlan = {
              calls: tp.calls.map((c: any) => ({
                tool: String(asRecord(c).tool),
                parameters: asRecord(asRecord(c).parameters)
              })).filter(c => ALLOWED_POLICY_TOOLS.has(c.tool)),
              parallel: Boolean(tp.parallel ?? true)
            };
          }

          return {
            mode: enumValue(v.mode, ["reply", "silent", "deactivate"] as const, "reply"),
            intent: enumValue(v.intent, ["local_chat", "live_request", "memory_query", "memory_write", "factual_query", "system_status"] as const, "local_chat"),
            reason: String(v.reason || "auto"),
            needsThinking: Boolean(v.needsThinking ?? v.needs_thinking),
            toolPlan,
            focus: String(v.focus || "")
          };
        },
        { role: isMentioned ? "primary" : "secondary", temperature: 0.1, maxOutputTokens: 400 }
      );
    } catch (error) {
      return fallback;
    }
  }
}
