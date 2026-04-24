import type { MemoryEvent, MemoryTriageDecision } from "./events.js";

function snippet(text: string, maxChars = 64): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function triageMemoryEvent(event: MemoryEvent): MemoryTriageDecision {
  if (event.kind === "discord_message") {
    const hasAttachment = Boolean(event.message.attachments?.length || event.message.embeds?.length);
    const hasSubstance = event.message.content.trim().length >= 24;
    const writeExperience = event.replyRequired || hasAttachment || hasSubstance;
    return {
      importance: event.replyRequired ? "high" : hasAttachment || hasSubstance ? "medium" : "low",
      tags: [
        "discord",
        "message",
        ...(event.dm ? ["dm"] : ["guild"]),
        ...(event.mentionedBot ? ["mention"] : []),
        ...(writeExperience ? ["memory-worthy"] : []),
      ],
      reflection: `Memory triage saw Discord message ${event.message.id} from ${event.message.author.username}: ${snippet(event.message.content || "(empty)")}`,
      updatePeople: !event.message.author.bot,
      updateRelationships: !event.message.author.bot,
      updateChannels: true,
      updateGuilds: Boolean(event.message.guildId),
      writeExperience,
      writeDailySummary: writeExperience,
    };
  }

  if (event.kind === "discord_reply") {
    return {
      importance: "medium",
      tags: ["discord", "reply", event.route],
      reflection: `Memory triage recorded Discord reply ${event.message.id} via ${event.route}.`,
      updatePeople: Boolean(event.targetUserId),
      updateRelationships: Boolean(event.targetUserId),
      updateChannels: true,
      updateGuilds: Boolean(event.message.guildId),
      writeExperience: true,
      writeDailySummary: true,
    };
  }

  const importantAction =
    /start|stop|load_model|trigger_motion|set_expression|set_background|caption|audio|speech/i.test(event.action);
  const textful = Boolean(event.text?.trim());
  return {
    importance: importantAction || textful ? "medium" : "low",
    tags: ["live", event.action, ...(event.ok ? ["ok"] : ["error"]), ...(textful ? ["text"] : [])],
    reflection: `Memory triage recorded live action ${event.action}: ${snippet(event.summary)}`,
    updatePeople: false,
    updateRelationships: false,
    updateChannels: false,
    updateGuilds: false,
    writeExperience: importantAction || textful,
    writeDailySummary: importantAction || textful,
  };
}
