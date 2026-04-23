import type { MinecraftPosition } from "../types.js";
import { Vec3 } from "vec3";

export function now(): number {
  return Date.now();
}

export function toPosition(source: any): MinecraftPosition | null {
  if (!source) return null;
  return {
    x: Number(source.x ?? 0),
    y: Number(source.y ?? 0),
    z: Number(source.z ?? 0),
  };
}

export function toVec3(position: MinecraftPosition): Vec3 {
  return new Vec3(
    Math.floor(position.x),
    Math.floor(position.y),
    Math.floor(position.z)
  );
}

export function isAirLike(block: any): boolean {
  return !block || ["air", "cave_air", "void_air"].includes(block.name);
}

export async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out during ${label} after ${timeoutMs}ms.`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
