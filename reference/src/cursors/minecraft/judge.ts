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
    case "inventory_snapshot":
    case "nearby_blocks":
    case "nearby_entities":
      return {
        executable: isConnected(observation) && isSpawned(observation),
        reason:
          isConnected(observation) && isSpawned(observation)
            ? "Minecraft read action can execute because the bot is connected and spawned."
            : "Minecraft read action requires a connected, spawned bot.",
        actionPlan,
      };
    case "prepare_wooden_pickaxe":
    case "build_wooden_house":
    case "give_creative_item":
    case "equip_item":
    case "mine_block_at":
    case "place_block_at":
    case "collect_blocks":
    case "craft_recipe":
      return {
        executable: isConnected(observation) && isSpawned(observation),
        reason:
          isConnected(observation) && isSpawned(observation)
            ? "Minecraft world/action skill can execute because the bot is connected and spawned."
            : "Minecraft world/action skill requires a connected, spawned bot.",
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
    case "set_follow_target": {
      const playerVisible = observation?.knownPlayers.some(
        (player) => player.username === actionPlan.input.username
      );
      return {
        executable:
          isConnected(observation) && isSpawned(observation) && Boolean(playerVisible),
        reason: !isConnected(observation) || !isSpawned(observation)
          ? "Setting a follow target requires a connected, spawned bot."
          : playerVisible
            ? "Target player is visible; follow target can be set."
            : `Player "${actionPlan.input.username}" is not visible in current observation.`,
        actionPlan: {
          type: "set_follow_target",
          input: {
            ...actionPlan.input,
            range: actionPlan.input.range ?? 2,
          },
        } satisfies MinecraftAction,
      };
    }
    case "clear_follow_target":
    case "stop":
      return {
        executable: isConnected(observation),
        reason: isConnected(observation)
          ? "Stop can clear the current movement or follow goal."
          : "Stop/clear follow is ignored because the bot is disconnected.",
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
