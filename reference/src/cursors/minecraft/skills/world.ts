import type {
  MinecraftBlockSummary,
  MinecraftEntitySummary,
  MinecraftPosition,
} from "../types.js";
import { Vec3 } from "vec3";
import { findInventoryItem } from "./inventory.js";
import { isAirLike, toPosition, toVec3, wait, withTimeout } from "./common.js";

export function summarizeNearbyBlocks(
  bot: any,
  range = 6,
  limit = 32
): MinecraftBlockSummary[] {
  if (!bot?.entity?.position || !bot.blockAt) return [];

  const clampedRange = Math.max(1, Math.min(Math.floor(range), 10));
  const clampedLimit = Math.max(1, Math.min(Math.floor(limit), 128));
  const origin = bot.entity.position.floored();
  const blocks: MinecraftBlockSummary[] = [];

  for (let x = -clampedRange; x <= clampedRange; x += 1) {
    for (let y = -clampedRange; y <= clampedRange; y += 1) {
      for (let z = -clampedRange; z <= clampedRange; z += 1) {
        const position = origin.offset(x, y, z);
        const block = bot.blockAt(position);
        if (!block || isAirLike(block)) continue;
        blocks.push({
          name: String(block.name ?? "unknown"),
          position: toPosition(block.position)!,
          distance: Number(bot.entity.position.distanceTo(block.position).toFixed(2)),
        });
      }
    }
  }

  return blocks
    .sort((left, right) => left.distance - right.distance)
    .slice(0, clampedLimit);
}

export function summarizeNearbyEntities(
  bot: any,
  range = 32,
  limit = 32
): MinecraftEntitySummary[] {
  if (!bot?.entity?.position) return [];
  const clampedRange = Math.max(1, Math.min(Math.floor(range), 128));
  const clampedLimit = Math.max(1, Math.min(Math.floor(limit), 128));

  return Object.values(bot.entities ?? {})
    .filter((entity: any) => entity?.id !== bot.entity.id && entity?.position)
    .map((entity: any) => ({
      entity,
      distance: bot.entity.position.distanceTo(entity.position),
    }))
    .filter(({ distance }) => distance <= clampedRange)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, clampedLimit)
    .map(({ entity, distance }) => ({
      id: Number(entity.id ?? -1),
      name: String(entity.name ?? entity.username ?? entity.displayName ?? "unknown"),
      type: String(entity.type ?? "unknown"),
      username: entity.username ?? null,
      position: toPosition(entity.position),
      distance: Number(distance.toFixed(2)),
    }));
}

export async function setBlockWithCommand(
  bot: any,
  position: Vec3,
  blockName: string,
  settleMs = 120
): Promise<void> {
  bot.chat(`/setblock ${position.x} ${position.y} ${position.z} ${blockName}`);
  await wait(settleMs);
}

export async function mineBlockAt(
  bot: any,
  position: MinecraftPosition,
  timeoutMs = 10000
): Promise<string> {
  const target = toVec3(position);
  const block = bot.blockAt(target);
  if (isAirLike(block)) return "Target block is already air.";

  if (bot.game?.gameMode === "creative") {
    await setBlockWithCommand(bot, target, "air");
    return `Removed ${block.name} at (${target.x}, ${target.y}, ${target.z}) via creative command.`;
  }

  await withTimeout(bot.dig(block), timeoutMs, `mine ${block.name}`);
  return `Mined ${block.name} at (${target.x}, ${target.y}, ${target.z}).`;
}

export async function placeBlockAt(
  bot: any,
  itemName: string,
  position: MinecraftPosition,
  method: "auto" | "command" | "hand" = "auto"
): Promise<string> {
  const target = toVec3(position);
  const existing = bot.blockAt(target);
  if (!isAirLike(existing)) {
    return `Skipped placement because ${existing.name} already occupies (${target.x}, ${target.y}, ${target.z}).`;
  }

  if (method === "command" || (method === "auto" && bot.game?.gameMode === "creative")) {
    await setBlockWithCommand(bot, target, itemName);
    return `Placed ${itemName} at (${target.x}, ${target.y}, ${target.z}) via command.`;
  }

  const reference = findPlacementReference(bot, target);
  if (!reference) {
    throw new Error(`No placement reference block exists near (${target.x}, ${target.y}, ${target.z}).`);
  }

  const item = findInventoryItem(bot, itemName);
  if (!item) {
    throw new Error(`No inventory item named "${itemName}" is available for hand placement.`);
  }

  await bot.equip(item, "hand");
  await bot.lookAt(target.offset(0.5, 0.5, 0.5), true);
  await withTimeout(
    bot.placeBlock(reference.block, reference.face),
    8000,
    `place ${itemName}`
  );
  return `Placed ${itemName} at (${target.x}, ${target.y}, ${target.z}) by hand.`;
}

export async function collectBlocks(
  bot: any,
  goals: { GoalNear: new (x: number, y: number, z: number, range: number) => any } | null,
  blockName: string,
  count = 1,
  range = 16
): Promise<string> {
  if (!goals || !bot.pathfinder) {
    throw new Error("Pathfinder is not ready for collect_blocks.");
  }
  const desiredCount = Math.max(1, Math.min(count, 16));
  const targets = summarizeNearbyBlocks(bot, range, 128)
    .filter((block) => block.name === blockName)
    .slice(0, desiredCount * 4);

  if (targets.length === 0 && bot.findBlocks) {
    const blockInfo = bot.registry.blocksByName[blockName];
    if (!blockInfo) {
      throw new Error(`Minecraft block "${blockName}" is not available in this registry.`);
    }
    const found = bot.findBlocks({
      matching: blockInfo.id,
      maxDistance: Math.max(1, Math.min(range, 128)),
      count: desiredCount * 8,
    });
    targets.push(
      ...found.map((position: Vec3) => ({
        name: blockName,
        position: toPosition(position)!,
        distance: Number(bot.entity.position.distanceTo(position).toFixed(2)),
      }))
    );
  }

  if (targets.length === 0) {
    throw new Error(`No nearby ${blockName} block found within range ${range}.`);
  }

  let collected = 0;
  for (const target of targets) {
    if (collected >= desiredCount) break;
    const pos = toVec3(target.position);
    try {
      const blockBeforeMove = bot.blockAt(pos);
      if (blockBeforeMove && bot.collectBlock?.collect) {
        await withTimeout(
          bot.collectBlock.collect(blockBeforeMove),
          45000,
          `collect ${blockName}`
        );
        await wait(500);
        collected += 1;
        continue;
      }

      await withTimeout(
        bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 1)),
        20000,
        `goto ${blockName}`
      );
      const block = bot.blockAt(pos);
      if (block && !isAirLike(block)) {
        if (bot.tool?.equipForBlock) {
          await bot.tool.equipForBlock(block, {});
        }
        await withTimeout(bot.dig(block), 10000, `dig ${blockName}`);
        await wait(1000);
        collected += 1;
      }
    } catch {
      if (bot.pathfinder?.setGoal) bot.pathfinder.setGoal(null);
    }
  }

  if (collected === 0) {
    throw new Error(`Found ${targets.length} ${blockName} candidates, but none were reachable.`);
  }
  return `Collected ${collected}/${desiredCount} ${blockName} blocks.`;
}

function findPlacementReference(bot: any, target: Vec3): { block: any; face: Vec3 } | null {
  const candidates = [
    new Vec3(0, -1, 0),
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1),
    new Vec3(0, 1, 0),
  ];

  for (const offset of candidates) {
    const block = bot.blockAt(target.plus(offset));
    if (block && !isAirLike(block) && block.boundingBox === "block") {
      return { block, face: offset.scaled(-1) };
    }
  }

  return null;
}
