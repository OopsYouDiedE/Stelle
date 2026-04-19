import { stelleMainLoop } from "../../core/runtime.js";
import { MineflayerMinecraftCursor } from "./MinecraftCursor.js";
import { mineflayerRuntime } from "./runtime.js";
import type { MinecraftConnectionConfig } from "./types.js";

let minecraftCursorSingleton: MineflayerMinecraftCursor | null = null;

export function getMinecraftCursor(): MineflayerMinecraftCursor {
  if (!minecraftCursorSingleton) {
    minecraftCursorSingleton = new MineflayerMinecraftCursor({
      id: "minecraft-main",
      runtime: mineflayerRuntime,
    });
    stelleMainLoop.registerCursor(minecraftCursorSingleton);
  }
  return minecraftCursorSingleton;
}

export function getMinecraftConfigFromEnv():
  | MinecraftConnectionConfig
  | null {
  const host = process.env.MINECRAFT_HOST?.trim();
  const username = process.env.MINECRAFT_USERNAME?.trim();
  if (!host || !username) return null;
  const portRaw = process.env.MINECRAFT_PORT?.trim();
  const versionRaw = process.env.MINECRAFT_VERSION?.trim();
  const authRaw = process.env.MINECRAFT_AUTH?.trim();
  const password = process.env.MINECRAFT_PASSWORD?.trim();

  return {
    host,
    username,
    port: portRaw ? Number(portRaw) : undefined,
    version: versionRaw ? versionRaw : undefined,
    auth:
      authRaw === "microsoft" || authRaw === "mojang" || authRaw === "offline"
        ? authRaw
        : "offline",
    password: password || undefined,
  };
}
