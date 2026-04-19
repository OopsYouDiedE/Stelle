import type { CursorActivation, CursorReport } from "../base.js";
import type {
  MinecraftAction,
  MinecraftActionResult,
  MinecraftConnectionConfig,
  MinecraftCursor,
  MinecraftCursorContext,
  MinecraftObservation,
  MinecraftRunRequest,
  MinecraftRunResult,
  MinecraftSnapshot,
} from "./types.js";
import type { MinecraftRuntime } from "./runtime.js";

export interface MinecraftCursorOptions {
  id?: string;
  runtime: MinecraftRuntime;
}

function now(): number {
  return Date.now();
}

function toPosition(source: any): { x: number; y: number; z: number } | null {
  if (!source) return null;
  return {
    x: Number(source.x ?? 0),
    y: Number(source.y ?? 0),
    z: Number(source.z ?? 0),
  };
}

export class MineflayerMinecraftCursor implements MinecraftCursor {
  readonly id: string;
  readonly kind = "minecraft" as const;

  private readonly runtime: MinecraftRuntime;
  private status: MinecraftSnapshot["status"] = "disconnected";
  private bot: any | null = null;
  private movements: any | null = null;
  private goals:
    | {
        GoalNear: new (x: number, y: number, z: number, range: number) => any;
        GoalFollow: new (entity: any, range: number) => any;
      }
    | null = null;
  private readonly context: MinecraftCursorContext = {
    connection: null,
    activeRequest: null,
    lastObservation: null,
    recentActivations: [],
    recentReports: [],
    lastActivatedAt: null,
    lastReportAt: null,
  };

  constructor(options: MinecraftCursorOptions) {
    this.id = options.id ?? "minecraft-main";
    this.runtime = options.runtime;
  }

  async activate(input: CursorActivation): Promise<void> {
    this.context.recentActivations.push(input);
    this.context.lastActivatedAt = input.timestamp;
    if (input.type === "minecraft_connect") {
      const config = (input.payload as { config?: MinecraftConnectionConfig } | undefined)
        ?.config;
      if (config) {
        await this.connect(config);
      }
    } else if (input.type === "minecraft_disconnect") {
      await this.disconnect();
    }
  }

  async tick(): Promise<CursorReport[]> {
    const reports: CursorReport[] = [];
    if (this.bot) {
      const observation = this.observe();
      this.context.lastObservation = observation;
      reports.push(
        this.makeReport("status", `Minecraft cursor tick on ${observation.host ?? "unknown host"}.`, {
          observation,
        })
      );
    }
    return reports;
  }

  async connect(config: MinecraftConnectionConfig): Promise<MinecraftActionResult> {
    if (this.bot) {
      await this.disconnect();
    }

    this.status = "connecting";
    this.context.connection = config;
    const bot = await this.runtime.createBot(config);
    this.bot = bot;
    const pathfinder = await this.runtime.loadPathfinder(bot);
    this.goals = pathfinder.goals;
    this.movements = new pathfinder.Movements(bot);
    if (bot.pathfinder?.setMovements) {
      bot.pathfinder.setMovements(this.movements);
    }
    this.bindBotEvents(bot);

    return {
      ok: true,
      actionType: "connect",
      summary: `Connecting to Minecraft server ${config.host}:${config.port ?? 25565} as ${config.username}.`,
      timestamp: now(),
    };
  }

  async disconnect(): Promise<MinecraftActionResult> {
    if (this.bot) {
      try {
        this.bot.end?.("Stelle Minecraft cursor disconnect");
      } catch {
        // ignore runtime shutdown errors
      }
    }
    this.bot = null;
    this.movements = null;
    this.goals = null;
    this.status = "disconnected";
    return {
      ok: true,
      actionType: "disconnect",
      summary: "Minecraft cursor disconnected.",
      timestamp: now(),
    };
  }

  async run(request: MinecraftRunRequest): Promise<MinecraftRunResult> {
    this.context.activeRequest = request;
    this.status = this.bot ? "active" : this.status;
    const reports: CursorReport[] = [];
    let actionResult: MinecraftActionResult | undefined;

    try {
      actionResult = await this.executeAction(request.action);
      const observation = this.observe();
      this.context.lastObservation = observation;
      reports.push(
        this.makeReport("task_result", actionResult.summary, {
          actionType: request.action.type,
          observation,
        })
      );
      return {
        requestId: request.id,
        ok: actionResult.ok,
        summary: actionResult.summary,
        actionResult,
        observation,
        reports,
      };
    } catch (error) {
      this.status = "error";
      const report = this.makeReport("error", `Minecraft action failed: ${(error as Error).message}`);
      reports.push(report);
      return {
        requestId: request.id,
        ok: false,
        summary: report.summary,
        observation: this.observe(),
        reports,
      };
    } finally {
      this.context.activeRequest = null;
    }
  }

  async snapshot(): Promise<MinecraftSnapshot> {
    return {
      cursorId: this.id,
      kind: "minecraft",
      status: this.status,
      summary: this.buildSummary(),
      activeRequestId: this.context.activeRequest?.id ?? null,
      connection: this.context.connection,
      lastObservation: this.context.lastObservation,
      lastReportAt: this.context.lastReportAt,
    };
  }

  private async executeAction(action: MinecraftAction): Promise<MinecraftActionResult> {
    switch (action.type) {
      case "connect":
        return this.connect(action.input);
      case "disconnect":
        return this.disconnect();
      case "chat":
        this.assertBotReady();
        this.bot.chat(action.input.message);
        return {
          ok: true,
          actionType: "chat",
          summary: `Sent Minecraft chat: ${action.input.message}`,
          timestamp: now(),
        };
      case "inspect":
        return {
          ok: true,
          actionType: "inspect",
          summary: `Observed Minecraft state: ${this.buildSummary()}`,
          timestamp: now(),
        };
      case "goto": {
        this.assertPathfinderReady();
        const range = action.input.range ?? 1;
        const goal = new this.goals!.GoalNear(
          action.input.x,
          action.input.y,
          action.input.z,
          range
        );
        await this.bot.pathfinder.goto(goal);
        return {
          ok: true,
          actionType: "goto",
          summary: `Moved near (${action.input.x}, ${action.input.y}, ${action.input.z}) with range ${range}.`,
          timestamp: now(),
        };
      }
      case "follow_player": {
        this.assertPathfinderReady();
        const target = this.bot.players[action.input.username]?.entity;
        if (!target) {
          throw new Error(`Player "${action.input.username}" is not visible to the bot.`);
        }
        const goal = new this.goals!.GoalFollow(target, action.input.range ?? 2);
        this.bot.pathfinder.setGoal(goal, true);
        return {
          ok: true,
          actionType: "follow_player",
          summary: `Following player ${action.input.username}.`,
          timestamp: now(),
        };
      }
      case "stop":
        this.assertBotReady();
        if (this.bot.pathfinder?.setGoal) {
          this.bot.pathfinder.setGoal(null);
        } else if (this.bot.pathfinder?.stop) {
          this.bot.pathfinder.stop();
        }
        return {
          ok: true,
          actionType: "stop",
          summary: "Stopped current Minecraft movement goal.",
          timestamp: now(),
        };
      default:
        throw new Error(`Unsupported Minecraft action: ${(action as { type: string }).type}`);
    }
  }

  private observe(): MinecraftObservation {
    const bot = this.bot;
    const knownPlayers = bot
      ? Object.values(bot.players ?? {})
          .map((player: any) => ({
            username: String(player.username ?? ""),
            displayName: player.displayName?.toString?.() ?? null,
            position: toPosition(player.entity?.position),
          }))
          .filter((player: { username: string }) => player.username)
      : [];

    return {
      connected: Boolean(bot && !bot._client?.ended),
      spawned: Boolean(bot?.entity),
      username: bot?.username ?? this.context.connection?.username ?? null,
      host: this.context.connection?.host ?? null,
      port: this.context.connection?.port ?? 25565,
      health: bot?.health ?? null,
      food: bot?.food ?? null,
      dimension: bot?.game?.dimension ?? null,
      position: toPosition(bot?.entity?.position),
      knownPlayers,
      timestamp: now(),
    };
  }

  private buildSummary(): string {
    const observation = this.context.lastObservation ?? this.observe();
    if (!observation.connected) {
      return "Minecraft cursor disconnected.";
    }
    const pos = observation.position
      ? `(${observation.position.x.toFixed(1)}, ${observation.position.y.toFixed(1)}, ${observation.position.z.toFixed(1)})`
      : "unknown position";
    return `Connected as ${observation.username ?? "unknown"} on ${observation.host ?? "unknown host"} at ${pos}.`;
  }

  private bindBotEvents(bot: any): void {
    bot.once("spawn", () => {
      this.status = "connected";
      this.context.lastObservation = this.observe();
      this.pushReport(
        this.makeReport("status", `Minecraft bot spawned as ${bot.username}.`, {
          observation: this.context.lastObservation,
        })
      );
    });

    bot.on("chat", (username: string, message: string) => {
      this.pushReport(
        this.makeReport("observation", `Minecraft chat from ${username}: ${message}`, {
          username,
          message,
        })
      );
    });

    bot.on("end", (reason: unknown) => {
      this.status = "disconnected";
      this.pushReport(
        this.makeReport("status", `Minecraft connection ended: ${String(reason ?? "unknown")}`)
      );
      this.bot = null;
      this.movements = null;
      this.goals = null;
    });

    bot.on("kicked", (reason: unknown) => {
      this.status = "error";
      this.pushReport(
        this.makeReport("error", `Minecraft bot was kicked: ${String(reason ?? "unknown")}`)
      );
    });

    bot.on("error", (error: Error) => {
      this.status = "error";
      this.pushReport(
        this.makeReport("error", `Minecraft bot error: ${error.message}`)
      );
    });
  }

  private pushReport(report: CursorReport): void {
    this.context.recentReports.push(report);
    if (this.context.recentReports.length > 100) {
      this.context.recentReports.shift();
    }
    this.context.lastReportAt = report.timestamp;
  }

  private makeReport(
    type: CursorReport["type"],
    summary: string,
    payload?: Record<string, unknown>
  ): CursorReport {
    return {
      cursorId: this.id,
      type,
      summary,
      payload,
      timestamp: now(),
    };
  }

  private assertBotReady(): void {
    if (!this.bot) {
      throw new Error("Minecraft bot is not connected.");
    }
  }

  private assertPathfinderReady(): void {
    this.assertBotReady();
    if (!this.goals || !this.bot.pathfinder) {
      throw new Error("Minecraft pathfinder is not ready.");
    }
  }
}
