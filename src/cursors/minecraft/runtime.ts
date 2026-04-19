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
    bot.loadPlugin(pathfinderModule.pathfinder);
    return {
      Movements: pathfinderModule.Movements,
      goals: {
        GoalNear: pathfinderModule.goals.GoalNear,
        GoalFollow: pathfinderModule.goals.GoalFollow,
      },
    };
  },
};
