import { ActivityType, type Client } from "discord.js";
import type { AttentionCycleResult, StelleSnapshot } from "../../stelle/types.js";

let lastPresence = "";

export async function updateDiscordPresence(input: {
  client: Client;
  cycle: AttentionCycleResult;
  snapshot: StelleSnapshot;
}): Promise<void> {
  const text = buildPresenceText(input.cycle, input.snapshot);
  if (!input.client.user || text === lastPresence) return;
  lastPresence = text;

  input.client.user.setPresence({
    status: "online",
    activities: [
      {
        name: text,
        type: ActivityType.Playing,
      },
    ],
  });
}

function buildPresenceText(
  cycle: AttentionCycleResult,
  snapshot: StelleSnapshot
): string {
  if (cycle.memoryReflections.length) {
    return "整理刚才的记忆";
  }

  const activeGoal = snapshot.consciousness.activeGoals[0] ?? null;
  if (activeGoal) {
    return truncatePresence(`琢磨：${activeGoal.summary}`);
  }

  const commitment = snapshot.consciousness.activeCommitments[0] ?? null;
  if (commitment) {
    return truncatePresence(`记着：${commitment.summary}`);
  }

  const inspected = cycle.decisions.find(
    (decision) => decision.type === "inspect_cursor"
  );
  if (inspected?.type === "inspect_cursor") {
    const window = snapshot.windows.registeredWindows.find(
      (item) => item.id === inspected.cursorId
    );
    return `看着${windowLabel(window?.kind)}`;
  }

  const waiting = cycle.decisions.find((decision) => decision.type === "wait");
  if (waiting?.type === "wait") {
    return "安静听着周围";
  }

  return "在世界里发呆";
}

function windowLabel(kind: string | undefined): string {
  switch (kind) {
    case "discord":
      return "聊天";
    case "browser":
      return "网页";
    case "minecraft":
      return "方块世界";
    case "audio":
      return "声音";
    default:
      return "某个窗口";
  }
}

function truncatePresence(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}
