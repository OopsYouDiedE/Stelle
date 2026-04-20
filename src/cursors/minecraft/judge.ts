import type {
  MinecraftAction,
  MinecraftJudgeInput,
  MinecraftJudgeResult,
  MinecraftObservation,
} from "./types.js";

function isConnected(observation: MinecraftObservation | null): boolean {
  return Boolean(observation?.connected);
}

function isSpawned(observation: MinecraftObservation | null): boolean {
  return Boolean(observation?.spawned);
}

export function judgeMinecraftRun(input: MinecraftJudgeInput): MinecraftJudgeResult {
  const observation = input.context.lastObservation;
  const actionPlan = input.request.action;

  switch (actionPlan.type) {
    case "connect":
      if (isConnected(observation)) {
        return {
          executable: false,
          reason: "Minecraft cursor is already connected; disconnect before reconnecting.",
          actionPlan,
        };
      }
      return {
        executable: true,
        reason: "Connection request is valid while disconnected.",
        actionPlan,
      };
    case "disconnect":
      return {
        executable: true,
        reason: isConnected(observation)
          ? "Disconnecting active Minecraft session."
          : "Disconnect is safe even when already disconnected.",
        actionPlan,
      };
    case "inspect":
      return {
        executable: true,
        reason: "Inspect only reads current Minecraft state.",
        actionPlan,
      };
    case "chat":
      return {
        executable: isConnected(observation) && isSpawned(observation),
        reason:
          isConnected(observation) && isSpawned(observation)
            ? "Chat can be sent while the bot is connected and spawned."
            : "Minecraft chat requires a connected, spawned bot.",
        actionPlan,
      };
    case "goto":
      return {
        executable: isConnected(observation) && isSpawned(observation),
        reason:
          isConnected(observation) && isSpawned(observation)
            ? "Movement is allowed because the bot is connected and spawned."
            : "Minecraft movement requires a connected, spawned bot.",
        actionPlan: {
          type: "goto",
          input: {
            ...actionPlan.input,
            range: actionPlan.input.range ?? 1,
          },
        } satisfies MinecraftAction,
      };
    case "follow_player": {
      const playerVisible = observation?.knownPlayers.some(
        (player) => player.username === actionPlan.input.username
      );
      return {
        executable:
          isConnected(observation) && isSpawned(observation) && Boolean(playerVisible),
        reason: !isConnected(observation) || !isSpawned(observation)
          ? "Following a player requires a connected, spawned bot."
          : playerVisible
            ? "Target player is visible; follow request can execute."
            : `Player "${actionPlan.input.username}" is not visible in current observation.`,
        actionPlan: {
          type: "follow_player",
          input: {
            ...actionPlan.input,
            range: actionPlan.input.range ?? 2,
          },
        } satisfies MinecraftAction,
      };
    }
    case "stop":
      return {
        executable: isConnected(observation),
        reason: isConnected(observation)
          ? "Stop can clear the current movement goal."
          : "Stop is ignored because the bot is disconnected.",
        actionPlan,
      };
    default:
      return {
        executable: true,
        reason: "Minecraft action judged executable.",
        actionPlan,
      };
  }
}
