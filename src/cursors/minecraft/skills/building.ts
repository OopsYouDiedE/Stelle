import type { MinecraftRuntime } from "../runtime.js";
import type { MinecraftPosition } from "../types.js";
import { Vec3 } from "vec3";
import { ensureCreativeItem } from "./inventory.js";
import { isAirLike, toVec3, wait } from "./common.js";
import { placeBlockAt } from "./world.js";

export async function buildWoodenHouse(
  runtime: MinecraftRuntime,
  bot: any,
  input?: {
    origin?: MinecraftPosition;
    width?: number;
    depth?: number;
    height?: number;
  }
): Promise<string> {
  const width = Math.max(3, Math.min(input?.width ?? 4, 5));
  const depth = Math.max(3, Math.min(input?.depth ?? 4, 5));
  const height = Math.max(2, Math.min(input?.height ?? 2, 3));
  const current = bot.entity.position.floored();
  const origin = input?.origin ? toVec3(input.origin) : current.offset(4, 0, -2);

  if (bot.game?.gameMode === "creative") {
    await ensureCreativeItem(runtime, bot, "oak_planks", 64, 36);
    await ensureCreativeItem(runtime, bot, "oak_door", 1, 37).catch(() => undefined);

    const placed = await buildWoodenHouseWithCommands(bot, origin, width, depth, height);
    if (placed > 0) {
      await bot.chat(`Built a small wooden house at ${origin.x}, ${origin.y}, ${origin.z}.`);
      return `Built wooden house at (${origin.x}, ${origin.y}, ${origin.z}) with ${placed} command placements.`;
    }
  }

  const handOrigin = input?.origin ? origin : current.offset(1, 0, 1);
  const handPlaced = await buildWoodenHouseByHand(bot, handOrigin, width, depth, height);
  await bot.chat(`Built a small wooden house at ${origin.x}, ${origin.y}, ${origin.z}.`);
  return `Built wooden house at (${handOrigin.x}, ${handOrigin.y}, ${handOrigin.z}) with ${handPlaced} hand placements.`;
}

async function buildWoodenHouseWithCommands(
  bot: any,
  origin: Vec3,
  width: number,
  depth: number,
  height: number
): Promise<number> {
  let placed = 0;
  const setBlock = async (position: Vec3, blockName: string) => {
    bot.chat(`/setblock ${position.x} ${position.y} ${position.z} ${blockName}`);
    placed += 1;
    await wait(75);
  };

  for (let x = 0; x < width; x += 1) {
    for (let z = 0; z < depth; z += 1) {
      await setBlock(origin.offset(x, 0, z), "oak_planks");
    }
  }

  for (let y = 1; y <= height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let z = 0; z < depth; z += 1) {
        const isWall = x === 0 || x === width - 1 || z === 0 || z === depth - 1;
        const isDoor = z === Math.floor(depth / 2) && x === 0 && (y === 1 || y === 2);
        if (isWall && !isDoor) {
          await setBlock(origin.offset(x, y, z), "oak_planks");
        } else if (isDoor) {
          await setBlock(origin.offset(x, y, z), "air");
        }
      }
    }
  }

  for (let x = -1; x <= width; x += 1) {
    for (let z = -1; z <= depth; z += 1) {
      await setBlock(origin.offset(x, height + 1, z), "oak_planks");
    }
  }

  return placed;
}

async function buildWoodenHouseByHand(
  bot: any,
  origin: Vec3,
  width: number,
  depth: number,
  height: number
): Promise<number> {
  let placed = 0;
  for (let x = 0; x < width; x += 1) {
    for (let z = 0; z < depth; z += 1) {
      if (await tryPlaceItemAt(bot, "oak_planks", origin.offset(x, 0, z))) placed += 1;
    }
  }

  for (let y = 1; y <= height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let z = 0; z < depth; z += 1) {
        const isWall = x === 0 || x === width - 1 || z === 0 || z === depth - 1;
        const isDoor = z === Math.floor(depth / 2) && x === 0 && (y === 1 || y === 2);
        if (isWall && !isDoor) {
          if (await tryPlaceItemAt(bot, "oak_planks", origin.offset(x, y, z))) placed += 1;
        }
      }
    }
  }

  for (let x = -1; x <= width; x += 1) {
    for (let z = -1; z <= depth; z += 1) {
      if (await tryPlaceItemAt(bot, "oak_planks", origin.offset(x, height + 1, z))) placed += 1;
    }
  }

  return placed;
}

async function tryPlaceItemAt(bot: any, itemName: string, target: Vec3): Promise<boolean> {
  try {
    const existing = bot.blockAt(target);
    if (!isAirLike(existing)) return false;
    await placeBlockAt(bot, itemName, target, "hand");
    return true;
  } catch {
    return false;
  }
}
