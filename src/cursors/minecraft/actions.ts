import type { MinecraftRuntime } from "./runtime.js";
import type { MinecraftAction, MinecraftActionResult } from "./types.js";
import { now } from "./skills/common.js";
import { buildWoodenHouse } from "./skills/building.js";
import { craftRecipe, prepareWoodenPickaxe } from "./skills/crafting.js";
import {
  ensureCreativeItem,
  equipItem,
  summarizeInventory,
} from "./skills/inventory.js";
import {
  collectBlocks,
  mineBlockAt,
  placeBlockAt,
  summarizeNearbyBlocks,
  summarizeNearbyEntities,
} from "./skills/world.js";

export interface MinecraftActionEnvironment {
  runtime: MinecraftRuntime;
  getBot(): any | null;
  getGoals(): {
    GoalNear: new (x: number, y: number, z: number, range: number) => any;
    GoalFollow: new (entity: any, range: number) => any;
  } | null;
  assertBotReady(): void;
  assertPathfinderReady(): void;
  connect(input: Extract<MinecraftAction, { type: "connect" }>["input"]): Promise<MinecraftActionResult>;
  disconnect(): Promise<MinecraftActionResult>;
}

type MinecraftActionHandler<T extends MinecraftAction = MinecraftAction> = (
  action: T,
  env: MinecraftActionEnvironment
) => Promise<MinecraftActionResult>;

type HandlerMap = {
  [Type in MinecraftAction["type"]]?: MinecraftActionHandler<Extract<MinecraftAction, { type: Type }>>;
};

function result(
  actionType: MinecraftAction["type"],
  summary: string,
  ok = true
): MinecraftActionResult {
  return {
    ok,
    actionType,
    summary,
    timestamp: now(),
  };
}

export const minecraftActionRegistry: HandlerMap = {
  connect: (action, env) => env.connect(action.input),
  disconnect: (_action, env) => env.disconnect(),
  async chat(action, env) {
    env.assertBotReady();
    env.getBot()!.chat(action.input.message);
    return result("chat", `Sent Minecraft chat: ${action.input.message}`);
  },
  async inspect(_action, env) {
    env.assertBotReady();
    const bot = env.getBot()!;
    return result(
      "inspect",
      `Observed ${bot.username} in ${bot.game?.dimension ?? "unknown dimension"} at ${bot.entity?.position?.toString?.() ?? "unknown position"}.`
    );
  },
  async inventory_snapshot(action, env) {
    env.assertBotReady();
    const inventory = summarizeInventory(env.getBot()!, action.input?.limit ?? 36);
    return result(
      "inventory_snapshot",
      inventory.length > 0
        ? `Inventory: ${inventory.map((item) => `${item.name} x${item.count}`).join(", ")}.`
        : "Inventory is empty."
    );
  },
  async nearby_blocks(action, env) {
    env.assertBotReady();
    const blocks = summarizeNearbyBlocks(
      env.getBot()!,
      action.input?.range ?? 6,
      action.input?.limit ?? 32
    );
    return result(
      "nearby_blocks",
      blocks.length > 0
        ? `Nearby blocks: ${blocks.map((block) => `${block.name}@${block.position.x},${block.position.y},${block.position.z}`).join("; ")}.`
        : "No nearby solid blocks found."
    );
  },
  async nearby_entities(action, env) {
    env.assertBotReady();
    const entities = summarizeNearbyEntities(
      env.getBot()!,
      action.input?.range ?? 32,
      action.input?.limit ?? 32
    );
    return result(
      "nearby_entities",
      entities.length > 0
        ? `Nearby entities: ${entities.map((entity) => `${entity.name}:${entity.type}`).join(", ")}.`
        : "No nearby entities found."
    );
  },
  async give_creative_item(action, env) {
    env.assertBotReady();
    await ensureCreativeItem(
      env.runtime,
      env.getBot()!,
      action.input.item,
      action.input.count ?? 1,
      action.input.slot ?? 36
    );
    return result(
      "give_creative_item",
      `Granted ${action.input.count ?? 1} ${action.input.item} to slot ${action.input.slot ?? 36}.`
    );
  },
  async equip_item(action, env) {
    env.assertBotReady();
    await equipItem(env.getBot()!, action.input.item, action.input.destination ?? "hand");
    return result("equip_item", `Equipped ${action.input.item} to ${action.input.destination ?? "hand"}.`);
  },
  async mine_block_at(action, env) {
    env.assertBotReady();
    const summary = await mineBlockAt(
      env.getBot()!,
      action.input.position,
      action.input.timeoutMs ?? 10000
    );
    return result("mine_block_at", summary);
  },
  async place_block_at(action, env) {
    env.assertBotReady();
    const summary = await placeBlockAt(
      env.getBot()!,
      action.input.item,
      action.input.position,
      action.input.method ?? "auto"
    );
    return result("place_block_at", summary);
  },
  async collect_blocks(action, env) {
    env.assertPathfinderReady();
    const summary = await collectBlocks(
      env.getBot()!,
      env.getGoals(),
      action.input.block,
      action.input.count ?? 1,
      action.input.range ?? 16
    );
    return result("collect_blocks", summary);
  },
  async craft_recipe(action, env) {
    env.assertBotReady();
    const summary = await craftRecipe(
      env.runtime,
      env.getBot()!,
      action.input.item,
      action.input.count ?? 1,
      {
        useCraftingTable: action.input.useCraftingTable,
        creativeFallback: action.input.creativeFallback,
      }
    );
    return result("craft_recipe", summary);
  },
  async prepare_wooden_pickaxe(_action, env) {
    env.assertBotReady();
    return result("prepare_wooden_pickaxe", await prepareWoodenPickaxe(env.runtime, env.getBot()!));
  },
  async build_wooden_house(action, env) {
    env.assertBotReady();
    return result(
      "build_wooden_house",
      await buildWoodenHouse(env.runtime, env.getBot()!, action.input)
    );
  },
  async goto(action, env) {
    env.assertPathfinderReady();
    const bot = env.getBot()!;
    const goals = env.getGoals()!;
    const range = action.input.range ?? 1;
    const goal = new goals.GoalNear(action.input.x, action.input.y, action.input.z, range);
    await bot.pathfinder.goto(goal);
    return result(
      "goto",
      `Moved near (${action.input.x}, ${action.input.y}, ${action.input.z}) with range ${range}.`
    );
  },
  async follow_player(action, env) {
    env.assertPathfinderReady();
    const bot = env.getBot()!;
    const goals = env.getGoals()!;
    const target = bot.players[action.input.username]?.entity;
    if (!target) {
      throw new Error(`Player "${action.input.username}" is not visible to the bot.`);
    }
    const goal = new goals.GoalFollow(target, action.input.range ?? 2);
    bot.pathfinder.setGoal(goal, true);
    return result("follow_player", `Following player ${action.input.username}.`);
  },
  async set_follow_target(action, env) {
    const followAction: Extract<MinecraftAction, { type: "follow_player" }> = {
      type: "follow_player",
      input: action.input,
    };
    return minecraftActionRegistry.follow_player!(followAction, env);
  },
  async stop(_action, env) {
    env.assertBotReady();
    const bot = env.getBot()!;
    if (bot.pathfinder?.setGoal) {
      bot.pathfinder.setGoal(null);
    } else if (bot.pathfinder?.stop) {
      bot.pathfinder.stop();
    }
    return result("stop", "Stopped current Minecraft movement goal.");
  },
  async clear_follow_target(_action, env) {
    return minecraftActionRegistry.stop!({ type: "stop" }, env);
  },
};

export async function executeMinecraftAction(
  action: MinecraftAction,
  env: MinecraftActionEnvironment
): Promise<MinecraftActionResult> {
  const handler = minecraftActionRegistry[action.type] as MinecraftActionHandler | undefined;
  if (!handler) {
    throw new Error(`Unsupported Minecraft action: ${action.type}`);
  }
  return handler(action, env);
}
