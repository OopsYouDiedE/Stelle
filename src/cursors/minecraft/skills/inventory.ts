import type { MinecraftRuntime } from "../runtime.js";
import type { MinecraftInventoryItemSummary } from "../types.js";

export function summarizeInventory(bot: any, limit = 36): MinecraftInventoryItemSummary[] {
  return (bot?.inventory?.items?.() ?? [])
    .slice(0, Math.max(0, limit))
    .map((item: any) => ({
      name: String(item.name ?? "unknown"),
      count: Number(item.count ?? 0),
      slot: Number(item.slot ?? -1),
    }));
}

export function findInventoryItem(bot: any, itemName: string): any | null {
  return (
    bot?.inventory
      ?.items?.()
      ?.find((item: any) => item.name === itemName || item.displayName === itemName) ?? null
  );
}

export async function ensureCreativeItem(
  runtime: MinecraftRuntime,
  bot: any,
  name: string,
  count: number,
  slot = 36
): Promise<void> {
  if (bot.game?.gameMode !== "creative") {
    throw new Error(`Creative inventory item grant requires creative mode.`);
  }

  const itemInfo = bot.registry.itemsByName[name];
  if (!itemInfo) {
    throw new Error(`Minecraft item "${name}" is not available in this registry.`);
  }
  const item = await runtime.createItem(bot.version, itemInfo.id, count);
  await bot.creative.setInventorySlot(slot, item);
}

export async function equipItem(
  bot: any,
  itemName: string,
  destination: "hand" | "head" | "torso" | "legs" | "feet" | "off-hand" = "hand"
): Promise<void> {
  const item = findInventoryItem(bot, itemName);
  if (!item) {
    throw new Error(`No inventory item named "${itemName}" is available to equip.`);
  }
  await bot.equip(item, destination);
}
