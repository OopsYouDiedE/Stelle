import type { DiscordJudgeDecision } from "./types.js";
import type { DiscordChannelSession } from "./runtime.js";

export async function judgeDiscordTurn(
  session: DiscordChannelSession
): Promise<DiscordJudgeDecision | null> {
  const raw = (await session.callAi("judge")) as Record<string, unknown> | null;
  if (!raw) {
    return null;
  }

  const focus = raw.focus as Record<string, unknown> | undefined;
  const trigger = (raw.trigger as Record<string, unknown>) ?? {};
  const intent = (raw.intent as Record<string, unknown>) ?? { stance: "pass" };
  const recallUserId =
    raw.recall_user_id === null || raw.recall_user_id === undefined
      ? null
      : String(raw.recall_user_id);

  return {
    focus: typeof focus?.topic === "string" ? focus.topic : null,
    trigger,
    intent,
    recallUserId,
  };
}
