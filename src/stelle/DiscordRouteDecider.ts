export type DiscordRoute = "cursor" | "stelle";

export interface DiscordRouteDecision {
  route: DiscordRoute;
  reason: string;
  needsVerification: boolean;
  intent:
    | "local_answer"
    | "fact_check"
    | "live_action"
    | "social_action"
    | "self_or_system"
    | "memory_or_continuity"
    | "high_risk";
}

export interface DiscordRouteInput {
  text: string;
  isDm: boolean;
  mentionedOtherUsers: boolean;
}

export class DiscordRouteDecider {
  decide(input: DiscordRouteInput): DiscordRouteDecision {
    const text = normalize(input.text);
    if (isHighRisk(text)) {
      return {
        route: "stelle",
        reason: "high risk or potentially harmful request requires Core Mind judgment",
        needsVerification: needsVerification(text),
        intent: "high_risk",
      };
    }
    if (isLiveAction(text)) {
      return {
        route: "stelle",
        reason: "live/OBS output is an externally visible Stelle-level action",
        needsVerification: false,
        intent: "live_action",
      };
    }
    if (isSocialAction(text, input.mentionedOtherUsers)) {
      return {
        route: "stelle",
        reason: "targeted social action is proactive and externally visible",
        needsVerification: false,
        intent: "social_action",
      };
    }
    if (isSelfOrSystem(text)) {
      return {
        route: "stelle",
        reason: "request concerns Stelle/Core Mind identity, attachment, or system behavior",
        needsVerification: false,
        intent: "self_or_system",
      };
    }
    if (isMemoryOrContinuity(text)) {
      return {
        route: "stelle",
        reason: "memory and continuity changes belong to Core Mind",
        needsVerification: false,
        intent: "memory_or_continuity",
      };
    }
    if (needsVerification(text)) {
      return {
        route: "cursor",
        reason: "public fact-check can be handled by Discord Cursor using cursor search tools",
        needsVerification: true,
        intent: "fact_check",
      };
    }
    return {
      route: "cursor",
      reason: "ordinary direct mention/DM can be handled by Discord Cursor locally",
      needsVerification: false,
      intent: "local_answer",
    };
  }
}

export function needsVerification(text: string): boolean {
  return /新闻|最新|今天|昨天|刚刚|现在|查|查证|核实|搜索|来源|真的假的|是否属实|怎么回事|发生了什么|news|latest|source|verify|fact.?check/i.test(text);
}

export function isLiveAction(text: string): boolean {
  return /直播|推流|obs|live2d|字幕|讲给直播|上播|开播|下播|场景|口型|语音|念出来|读出来|背景/.test(text);
}

export function isSocialAction(text: string, mentionedOtherUsers: boolean): boolean {
  if (!mentionedOtherUsers) return false;
  return /调戏|逗|吐槽|夸|骂|提醒|催|叫他|叫她|跟他说|跟她说|帮我说|点名/.test(text);
}

export function isSelfOrSystem(text: string): boolean {
  return /stelle|core mind|大脑|召回|你是谁|你现在在哪|哪个窗口|当前窗口|附着|cursor|inner|人格|性格|主循环|main.?loop/i.test(text);
}

export function isMemoryOrContinuity(text: string): boolean {
  return /记住|记忆|忘掉|遗忘|以后都|长期|偏好|别再|不要再|下次/.test(text);
}

function isHighRisk(text: string): boolean {
  return /密码|token|api.?key|密钥|删库|删除全部|封禁|踢出|禁言|人肉|隐私|身份证|住址|手机号|自杀|伤害|违法|诈骗|爆破/.test(text);
}

function normalize(text: string): string {
  return text.replace(/<@!?\d+>/g, " ").replace(/\s+/g, " ").trim();
}
