import type { MinecraftConnectionConfig } from "./types.js";

export interface MinecraftRuntime {
  createBot(config: MinecraftConnectionConfig): Promise<any>;
  loadPathfinder(bot: any): Promise<{
    Movements: any;
    goals: {
      GoalNear: new (x: number, y: number, z: number, range: number) => any;
      GoalFollow: new (entity: any, range: number) => any;
    };
  }>;
  createItem(version: string, itemId: number, count: number): Promise<any>;
}

export const mineflayerRuntime: MinecraftRuntime = {
  async createBot(config: MinecraftConnectionConfig): Promise<any> {
    const mineflayer = await import("mineflayer");
    return mineflayer.createBot({
      host: config.host,
      username: config.username,
      port: config.port,
      ...(config.version === false ? {} : { version: config.version }),
      auth: config.auth,
      password: config.password,
    });
  },

  async loadPathfinder(bot: any): Promise<{
    Movements: any;
    goals: {
      GoalNear: new (x: number, y: number, z: number, range: number) => any;
      GoalFollow: new (entity: any, range: number) => any;
    };
  }> {
    const pathfinderModule = await import("mineflayer-pathfinder");
    const minecraftDataModule = await import("minecraft-data");
    const pathfinderApi = pathfinderModule.default ?? pathfinderModule;
    const minecraftData = minecraftDataModule.default ?? minecraftDataModule;
    const mcData = minecraftData(bot.version);
    bot.loadPlugin(pathfinderApi.pathfinder);
    await loadOptionalPlugin(bot, "mineflayer-tool");
    await loadOptionalPlugin(bot, "mineflayer-collectblock");
    await loadOptionalPlugin(bot, "mineflayer-auto-eat");
    await loadOptionalPlugin(bot, "mineflayer-armor-manager");
    await loadOptionalPlugin(bot, "mineflayer-pvp");
    return {
      Movements: class {
        constructor(innerBot: any) {
          return new (pathfinderApi.Movements as any)(innerBot, mcData);
        }
      },
      goals: {
        GoalNear: pathfinderApi.goals.GoalNear,
        GoalFollow: pathfinderApi.goals.GoalFollow,
      },
    };
  },

  async createItem(version: string, itemId: number, count: number): Promise<any> {
    const itemModule = await import("prismarine-item");
    const createItem = (itemModule.default ?? itemModule) as any;
    const Item = createItem(version);
    return new Item(itemId, count);
  },
};

async function loadOptionalPlugin(bot: any, packageName: string): Promise<void> {
  try {
    const pluginModule = await import(packageName);
    const plugin = (pluginModule.default ?? pluginModule).plugin;
    if (plugin) {
      bot.loadPlugin(plugin);
    }
  } catch {
    // Optional AIRI-style Minecraft plugins should not prevent basic cursor startup.
  }
}
