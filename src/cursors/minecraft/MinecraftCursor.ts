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
  MinecraftEnvironmentFrame,
  MinecraftStrategyContext,
  MinecraftStrategyRunRequest,
  MinecraftStrategyRunResult,
  MinecraftStrategyStepResult,
} from "./types.js";
import type { MinecraftRuntime } from "./runtime.js";
import { judgeMinecraftRun } from "./judge.js";
import { executeMinecraftAction } from "./actions.js";
import { judgeMinecraftStrategy } from "./strategyJudge.js";
import { getMinecraftStrategy } from "./strategies.js";
import { summarizeInventory } from "./skills/inventory.js";
import { summarizeNearbyBlocks, summarizeNearbyEntities } from "./skills/world.js";
import { toPosition } from "./skills/common.js";
import {
  captureMinecraftViewerImage,
  closeMinecraftViewer,
  renderMinecraftFallbackImage,
  startMinecraftViewer,
  type MinecraftViewerSession,
} from "./visual.js";

export interface MinecraftCursorOptions {
  id?: string;
  runtime: MinecraftRuntime;
}

function now(): number {
  return Date.now();
}

export class MineflayerMinecraftCursor implements MinecraftCursor {
  readonly id: string;
  readonly kind = "minecraft" as const;

  private readonly runtime: MinecraftRuntime;
  private readonly cwd: string;
  private readonly viewerPort: number;
  private status: MinecraftSnapshot["status"] = "disconnected";
  private bot: any | null = null;
  private viewer: MinecraftViewerSession | null = null;
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
    this.cwd = process.cwd();
    this.viewerPort = Number(process.env.MINECRAFT_VIEWER_PORT ?? 3007);
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
    this.bindBotEvents(bot);
    await this.waitForSpawn(bot, 60000);
    const pathfinder = await this.runtime.loadPathfinder(bot);
    this.goals = pathfinder.goals;
    this.movements = new pathfinder.Movements(bot);
    if (bot.pathfinder?.setMovements) {
      bot.pathfinder.setMovements(this.movements);
    }
    await this.startViewer(bot);

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
        closeMinecraftViewer(this.bot);
        this.bot.end?.("Stelle Minecraft cursor disconnect");
      } catch {
        // ignore runtime shutdown errors
      }
    }
    this.bot = null;
    this.viewer = null;
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
    const judge = judgeMinecraftRun({
      request,
      context: {
        connection: this.context.connection,
        activeRequest: this.context.activeRequest,
        lastObservation: this.context.lastObservation ?? this.observe(),
      },
    });

    reports.push(
      this.makeReport("status", `Minecraft judge: ${judge.reason}`, {
        executable: judge.executable,
        actionType: judge.actionPlan.type,
      })
    );

    if (!judge.executable) {
      this.context.activeRequest = null;
      return {
        requestId: request.id,
        ok: false,
        summary: `Minecraft judge rejected request: ${judge.reason}`,
        judge,
        observation: this.observe(),
        reports,
      };
    }

    try {
      actionResult = await this.executeAction(judge.actionPlan);
      const observation = this.observe();
      this.context.lastObservation = observation;
      reports.push(
        this.makeReport("task_result", actionResult.summary, {
          actionType: judge.actionPlan.type,
          observation,
        })
      );
      return {
        requestId: request.id,
        ok: actionResult.ok,
        summary: actionResult.summary,
        judge,
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
        judge,
        observation: this.observe(),
        reports,
      };
    } finally {
      this.context.activeRequest = null;
    }
  }

  async readEnvironmentFrame(): Promise<MinecraftEnvironmentFrame> {
    const observation = this.observe();
    this.context.lastObservation = observation;
    const image = observation.connected && this.viewer
      ? await captureMinecraftViewerImage(this.viewer, observation, this.cwd).catch(() =>
          renderMinecraftFallbackImage(observation, this.cwd).catch(() => null)
        )
      : observation.connected
        ? await renderMinecraftFallbackImage(observation, this.cwd).catch(() => null)
      : null;
    return {
      observation,
      image,
      summary: this.buildSummary(),
      timestamp: now(),
    };
  }

  async runStrategy(request: MinecraftStrategyRunRequest): Promise<MinecraftStrategyRunResult> {
    const strategy = getMinecraftStrategy(request.strategyId);
    if (!strategy) {
      const finalFrame = await this.readEnvironmentFrame();
      return {
        requestId: request.id,
        strategyId: request.strategyId,
        ok: false,
        summary: `Unknown Minecraft strategy "${request.strategyId}".`,
        steps: [],
        finalFrame,
        reports: [
          this.makeReport("error", `Unknown Minecraft strategy "${request.strategyId}".`),
        ],
      };
    }

    const maxSteps = Math.max(1, Math.min(request.maxSteps ?? 8, 32));
    const context: MinecraftStrategyContext = {
      strategyId: strategy.id,
      startedAt: now(),
      stepCount: 0,
      maxSteps,
      notes: request.note ? [request.note] : [],
    };
    const reports: CursorReport[] = [];
    const steps: MinecraftStrategyStepResult[] = [];
    let currentStrategy = strategy;

    for (let index = 0; index < maxSteps; index += 1) {
      context.stepCount = index;
      const frame = await this.readEnvironmentFrame();
      const decision = await currentStrategy.decide(frame, context);
      const judge = judgeMinecraftStrategy({
        frame,
        strategy: context,
        decision,
      });

      reports.push(
        this.makeReport("status", `Minecraft strategy judge: ${judge.reason}`, {
          strategyId: context.strategyId,
          decisionType: judge.decision.type,
          image: frame.image,
        })
      );

      if (!judge.executable) {
        steps.push({
          index,
          frame,
          judge,
          summary: judge.reason,
        });
        const finalFrame = await this.readEnvironmentFrame();
        return {
          requestId: request.id,
          strategyId: request.strategyId,
          ok: false,
          summary: judge.reason,
          steps,
          finalFrame,
          reports,
        };
      }

      if (judge.decision.type === "complete") {
        steps.push({
          index,
          frame,
          judge,
          summary: judge.decision.summary,
        });
        const finalFrame = await this.readEnvironmentFrame();
        return {
          requestId: request.id,
          strategyId: request.strategyId,
          ok: true,
          summary: judge.decision.summary,
          steps,
          finalFrame,
          reports,
        };
      }

      if (judge.decision.type === "fail") {
        steps.push({
          index,
          frame,
          judge,
          summary: judge.decision.reason,
        });
        const finalFrame = await this.readEnvironmentFrame();
        return {
          requestId: request.id,
          strategyId: request.strategyId,
          ok: false,
          summary: judge.decision.reason,
          steps,
          finalFrame,
          reports,
        };
      }

      if (judge.decision.type === "switch_strategy") {
        const next = getMinecraftStrategy(judge.decision.strategyId);
        if (!next) {
          steps.push({
            index,
            frame,
            judge,
            summary: `Requested unknown strategy "${judge.decision.strategyId}".`,
          });
          const finalFrame = await this.readEnvironmentFrame();
          return {
            requestId: request.id,
            strategyId: request.strategyId,
            ok: false,
            summary: `Requested unknown strategy "${judge.decision.strategyId}".`,
            steps,
            finalFrame,
            reports,
          };
        }
        currentStrategy = next;
        context.strategyId = next.id;
        context.notes.push(`Switched strategy: ${judge.decision.reason}`);
        steps.push({
          index,
          frame,
          judge,
          summary: `Switched to ${next.id}.`,
        });
        continue;
      }

      if (judge.decision.type === "wait") {
        await this.wait(judge.decision.waitMs);
        steps.push({
          index,
          frame,
          judge,
          summary: judge.decision.reason,
        });
        continue;
      }

      let actionResult: MinecraftActionResult;
      try {
        actionResult = await this.executeAction(
          judge.actionJudge?.actionPlan ?? judge.decision.action
        );
      } catch (error) {
        actionResult = {
          ok: false,
          actionType: judge.decision.action.type,
          summary: `Strategy action failed: ${(error as Error).message}`,
          timestamp: now(),
        };
      }
      context.lastActionResult = actionResult;
      steps.push({
        index,
        frame,
        judge,
        actionResult,
        summary: actionResult.summary,
      });
      reports.push(
        this.makeReport("task_result", actionResult.summary, {
          strategyId: context.strategyId,
          actionType: actionResult.actionType,
        })
      );
      if (judge.decision.waitMs) {
        await this.wait(judge.decision.waitMs);
      }
    }

    const finalFrame = await this.readEnvironmentFrame();
    return {
      requestId: request.id,
      strategyId: request.strategyId,
      ok: false,
      summary: `Strategy "${request.strategyId}" reached maxSteps=${maxSteps}.`,
      steps,
      finalFrame,
      reports,
    };
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
    return executeMinecraftAction(action, {
      runtime: this.runtime,
      getBot: () => this.bot,
      getGoals: () => this.goals,
      assertBotReady: () => this.assertBotReady(),
      assertPathfinderReady: () => this.assertPathfinderReady(),
      connect: (input) => this.connect(input),
      disconnect: () => this.disconnect(),
    });
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
      gameMode: bot?.game?.gameMode ?? null,
      health: bot?.health ?? null,
      food: bot?.food ?? null,
      dimension: bot?.game?.dimension ?? null,
      position: toPosition(bot?.entity?.position),
      inventory: bot ? summarizeInventory(bot, 12) : [],
      nearbyBlocks: bot ? summarizeNearbyBlocks(bot, 4, 24) : [],
      nearbyEntities: bot ? summarizeNearbyEntities(bot, 32, 24) : [],
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
      this.viewer = null;
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

  private async waitForSpawn(bot: any, timeoutMs: number): Promise<void> {
    if (bot.entity && bot.version) return;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for Minecraft spawn after ${timeoutMs}ms.`));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        bot.off?.("spawn", onSpawn);
        bot.off?.("kicked", onKicked);
        bot.off?.("error", onError);
        bot.off?.("end", onEnd);
      };
      const onSpawn = () => {
        cleanup();
        resolve();
      };
      const onKicked = (reason: unknown) => {
        cleanup();
        reject(new Error(`Minecraft bot was kicked before spawn: ${String(reason ?? "unknown")}`));
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onEnd = (reason: unknown) => {
        cleanup();
        reject(new Error(`Minecraft connection ended before spawn: ${String(reason ?? "unknown")}`));
      };

      bot.once?.("spawn", onSpawn);
      bot.once?.("kicked", onKicked);
      bot.once?.("error", onError);
      bot.once?.("end", onEnd);
    });
  }

  private async startViewer(bot: any): Promise<void> {
    if (this.viewer) return;
    try {
      this.viewer = await startMinecraftViewer(bot, {
        port: this.viewerPort,
        firstPerson: true,
        viewDistance: 6,
      });
      this.pushReport(
        this.makeReport("status", `Minecraft viewer started at ${this.viewer.url}.`, {
          viewer: this.viewer,
        })
      );
    } catch (error) {
      this.viewer = null;
      this.pushReport(
        this.makeReport("error", `Minecraft viewer failed to start: ${(error as Error).message}`)
      );
    }
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

  private async wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
