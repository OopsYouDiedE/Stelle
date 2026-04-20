import type { MinecraftRuntime } from "../runtime.js";
import { ensureCreativeItem, equipItem } from "./inventory.js";
import { isAirLike, wait, withTimeout } from "./common.js";
import { placeBlockAt } from "./world.js";

export async function craftRecipe(
  runtime: MinecraftRuntime,
  bot: any,
  itemName: string,
  count = 1,
  options?: {
    useCraftingTable?: boolean;
    creativeFallback?: boolean;
  }
): Promise<string> {
  const itemInfo = bot.registry.itemsByName[itemName];
  if (!itemInfo) {
    throw new Error(`Minecraft item "${itemName}" is not available in this registry.`);
  }

  let craftingTable: any | null = null;
  if (options?.useCraftingTable) {
    craftingTable = await ensureCraftingTable(bot);
  }

  const recipe = bot.recipesFor(itemInfo.id, null, count, craftingTable)[0];
  if (recipe) {
    await withTimeout(bot.craft(recipe, count, craftingTable), 25000, `craft ${itemName}`);
    await wait(300);
    return `Crafted ${count} ${itemName}.`;
  }

  if (options?.creativeFallback && bot.game?.gameMode === "creative") {
    await ensureCreativeItem(runtime, bot, itemName, count, 39);
    return `Prepared ${count} ${itemName} via creative inventory fallback.`;
  }

  throw new Error(`No craftable recipe for ${itemName} is currently available.`);
}

export async function prepareWoodenPickaxe(runtime: MinecraftRuntime, bot: any): Promise<string> {
  if (bot.game?.gameMode === "creative") {
    await ensureCreativeItem(runtime, bot, "oak_planks", 64, 36);
    await ensureCreativeItem(runtime, bot, "stick", 64, 37);
    await ensureCreativeItem(runtime, bot, "crafting_table", 8, 38);
  } else {
    await ensureOakPlanks(runtime, bot, countInventory(bot, "crafting_table") > 0 ? 5 : 9);
    if (countInventory(bot, "crafting_table") < 1) {
      await craftRecipe(runtime, bot, "crafting_table", 1);
    }
    await ensureOakPlanks(runtime, bot, 5);
    if (countInventory(bot, "stick") < 2) {
      await craftRecipe(runtime, bot, "stick", 1);
    }
    await ensureOakPlanks(runtime, bot, 3);
  }

  const summary = await craftRecipe(runtime, bot, "wooden_pickaxe", 1, {
    useCraftingTable: true,
    creativeFallback: true,
  });
  await equipItem(bot, "wooden_pickaxe", "hand");
  return `${summary} Equipped wooden_pickaxe.`;
}

function countInventory(bot: any, itemName: string): number {
  return (bot.inventory?.items?.() ?? [])
    .filter((item: any) => item.name === itemName)
    .reduce((total: number, item: any) => total + Number(item.count ?? 0), 0);
}

async function ensureOakPlanks(
  runtime: MinecraftRuntime,
  bot: any,
  requiredCount: number
): Promise<void> {
  while (countInventory(bot, "oak_planks") < requiredCount) {
    if (countInventory(bot, "oak_log") < 1) {
      throw new Error(
        `Need ${requiredCount} oak_planks, but only ${countInventory(bot, "oak_planks")} planks and no oak_log remain.`
      );
    }
    await craftRecipe(runtime, bot, "oak_planks", 1);
  }
}

async function ensureCraftingTable(bot: any): Promise<any> {
  const tableId = bot.registry.blocksByName.crafting_table?.id;
  if (!tableId) {
    throw new Error("crafting_table block is not available in this registry.");
  }

  const nearby = bot.findBlock?.({
    matching: tableId,
    maxDistance: 6,
  });
  if (nearby) return nearby;

  const tableItem = bot.inventory
    ?.items?.()
    ?.find((item: any) => item.name === "crafting_table");
  if (!tableItem) {
    throw new Error("A crafting table is required, but none is nearby or in inventory.");
  }

  const target = findCraftingTablePlacement(bot);
  if (!target) {
    throw new Error("No nearby empty space is available for placing a crafting table.");
  }

  await placeBlockAt(bot, "crafting_table", target, bot.game?.gameMode === "creative" ? "command" : "hand");
  await wait(300);
  const placed = bot.blockAt(target);
  if (!placed || placed.name !== "crafting_table") {
    throw new Error("Failed to place a crafting table for crafting.");
  }
  return placed;
}

function findCraftingTablePlacement(bot: any): any | null {
  const origin = bot.entity.position.floored();
  const candidates = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let radius = 1; radius <= 3; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
          candidates.push(origin.offset(dx, dy, dz));
        }
      }
    }
  }

  return (
    candidates.find((position) => {
      const block = bot.blockAt(position);
      const below = bot.blockAt(position.offset(0, -1, 0));
      return isAirLike(block) && below && !isAirLike(below) && below.boundingBox === "block";
    }) ?? null
  );
}
