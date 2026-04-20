import type { Client } from "discord.js";
import type { AttentionCycleResult } from "../../stelle/types.js";

const notifiedKeys = new Set<string>();

export async function notifyMinecraftResults(input: {
  client: Client;
  cycle: AttentionCycleResult;
}): Promise<void> {
  for (const report of input.cycle.reports) {
    if (report.cursorId !== "minecraft-main") continue;
    const payload = report.payload ?? {};
    const discord = payload.discord as
      | { channelId?: string; authorId?: string; messageId?: string }
      | undefined;
    if (!discord?.channelId) continue;

    const final = payload.final === true;
    const failed = report.type === "error";
    if (!final && !failed) continue;

    const key = [
      payload.sourceExperienceId ?? "unknown",
      report.type,
      report.summary,
    ].join("|");
    if (notifiedKeys.has(key)) continue;
    notifiedKeys.add(key);

    const channel = await input.client.channels.fetch(discord.channelId).catch(() => null);
    if (!channel?.isTextBased() || !channel.isSendable()) continue;

    const mention = discord.authorId ? `<@${discord.authorId}> ` : "";
    const content = `${mention}${formatMinecraftResult(report.type, report.summary)}`;
    await channel.send({
      content,
      allowedMentions: {
        users: discord.authorId ? [discord.authorId] : [],
        parse: [],
        repliedUser: false,
      },
      reply: discord.messageId
        ? {
            messageReference: discord.messageId,
            failIfNotExists: false,
          }
        : undefined,
    });
  }
}

function formatMinecraftResult(type: string, summary: string): string {
  if (type === "error") {
    return `Minecraft 那边没顺利完成：${summary}`;
  }
  return `Minecraft 那边执行完了：${summary}`;
}
