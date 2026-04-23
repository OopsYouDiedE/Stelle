import type { WindowRegistrySnapshot } from "../../core/windowRegistry.js";
import type { Experience } from "../types.js";
import type {
  ConsciousnessCommitment,
  ConsciousnessGoal,
  ConsciousnessIdleJudgement,
  ConsciousnessStrategyDecision,
} from "./types.js";

export function judgeIdleAttention(input: {
  recentExperiences: Experience[];
  currentFocusCursorId: string | null;
  activeGoals: ConsciousnessGoal[];
  activeCommitments: ConsciousnessCommitment[];
  lastObservedExperienceId: string | null;
  lastReflectionAt: number | null;
  reflectionIntervalMs: number;
  timestamp: number;
  windows: WindowRegistrySnapshot;
}): ConsciousnessIdleJudgement {
  const focus = chooseFocus(input.recentExperiences, input.currentFocusCursorId);
  const latestExperienceId = input.recentExperiences.at(-1)?.id ?? null;
  const shouldReflect =
    latestExperienceId !== input.lastObservedExperienceId ||
    input.lastReflectionAt === null ||
    input.timestamp - input.lastReflectionAt >= input.reflectionIntervalMs;

  return {
    focus,
    shouldReflect,
    decisions: buildIdleDecisions({
      focus,
      shouldReflect,
      experiences: input.recentExperiences,
      activeGoals: input.activeGoals,
      activeCommitments: input.activeCommitments,
      windows: input.windows,
    }),
    activeGoals: input.activeGoals,
    activeCommitments: input.activeCommitments,
    summary: buildReflectionSummary(
      focus,
      input.windows,
      input.activeGoals,
      input.activeCommitments
    ),
  };
}

function chooseFocus(
  experiences: Experience[],
  fallbackCursorId: string | null
): Experience | null {
  if (!experiences.length) return null;
  const focused = fallbackCursorId
    ? [...experiences]
        .reverse()
        .find((item: Experience) => item.sourceCursorId === fallbackCursorId)
    : null;
  const candidatePool = focused ? [focused, ...experiences] : experiences;
  return [...candidatePool].sort((a, b) => b.salience - a.salience)[0] ?? null;
}

function buildReflectionSummary(
  focus: Experience | null,
  windows: WindowRegistrySnapshot,
  activeGoals: readonly ConsciousnessGoal[],
  activeCommitments: readonly ConsciousnessCommitment[]
): string {
  if (!focus) {
    const kinds = windows.registeredWindows
      .map((window) => window.kind)
      .filter((kind, index, all) => all.indexOf(kind) === index)
      .join(", ");
    const active = activeGoals.length
      ? `, ${activeGoals.length} active goal(s)`
      : "";
    const commitments = activeCommitments.length
      ? `, ${activeCommitments.length} open commitment(s)`
      : "";
    return `Stelle is idle with ${windows.registeredCursorIds.length} window(s) available${kinds ? ` (${kinds})` : ""}${active}${commitments}, keeping quiet internal attention.`;
  }
  const goalNote = activeGoals.length
    ? ` Active goal: ${activeGoals[0].summary}`
    : "";
  return `Stelle reflects on ${focus.sourceKind}/${focus.sourceCursorId}: ${focus.summary}${goalNote}`;
}

function buildIdleDecisions(input: {
  focus: Experience | null;
  shouldReflect: boolean;
  experiences: Experience[];
  activeGoals: ConsciousnessGoal[];
  activeCommitments: ConsciousnessCommitment[];
  windows: WindowRegistrySnapshot;
}): ConsciousnessStrategyDecision[] {
  const decisions: ConsciousnessStrategyDecision[] = [];
  const minecraftRequest = findMinecraftRequest(input.experiences);

  if (minecraftRequest) {
    if (minecraftRequest.connectionConfig) {
      decisions.push({
        type: "act_through_cursor",
        cursorId: "minecraft-main",
        activationType: "minecraft_connect",
        reason: `Connect Minecraft window from Discord request: ${minecraftRequest.summary}`,
        payload: {
          config: minecraftRequest.connectionConfig,
          sourceExperienceId: minecraftRequest.experienceId,
          discord: minecraftRequest.discord,
        },
      });
    }
    decisions.push({
      type: "act_through_cursor",
      cursorId: "minecraft-main",
      activationType: minecraftRequest.strategyId
        ? "minecraft_run_strategy"
        : "minecraft_run_action",
      reason: `Route Discord Minecraft request through Stelle: ${minecraftRequest.summary}`,
      payload: {
        action: minecraftRequest.action,
        strategyId: minecraftRequest.strategyId,
        maxSteps: minecraftRequest.strategyId === "iron_prospect" ? 4 : undefined,
        note: minecraftRequest.summary,
        sourceExperienceId: minecraftRequest.experienceId,
        coordinateHint: minecraftRequest.coordinateHint,
        discord: minecraftRequest.discord,
      },
    });
  }

  const memorableIds = input.experiences
    .filter((experience) => experience.salience >= 0.7)
    .map((experience) => experience.id);

  if (memorableIds.length) {
    decisions.push({
      type: "remember",
      experienceIds: memorableIds,
      reason: "Recent high-salience experiences should be considered for long-term memory.",
    });
  }

  const activeGoal = input.activeGoals[0] ?? null;
  if (activeGoal) {
    decisions.push({
      type: "continue",
      reason: `Continue active goal ${activeGoal.id}: ${activeGoal.summary}`,
    });
    decisions.push({
      type: "inspect_cursor",
      cursorId: activeGoal.cursorId,
      reason: `Check the window connected to active goal ${activeGoal.id}.`,
    });
  }

  const openCommitment = input.activeCommitments[0] ?? null;
  if (openCommitment && openCommitment.cursorId !== activeGoal?.cursorId) {
    decisions.push({
      type: "inspect_cursor",
      cursorId: openCommitment.cursorId,
      reason: `Review open commitment ${openCommitment.id}: ${openCommitment.summary}`,
    });
  }

  if (input.focus && input.shouldReflect) {
    decisions.push({
      type: "inspect_cursor",
      cursorId: input.focus.sourceCursorId,
      reason: `Attention is focused on ${input.focus.sourceKind}/${input.focus.sourceCursorId}.`,
    });
  }

  if (!decisions.length) {
    decisions.push({
      type: "wait",
      durationMs: 15_000,
      reason: `No salient experience is pending across ${input.windows.registeredCursorIds.length} window(s).`,
    });
  }

  return decisions;
}

function findMinecraftRequest(
  experiences: readonly Experience[]
): {
  experienceId: string;
  summary: string;
  action: {
    type: "collect_blocks";
    input: { block: string; count: number; range: number };
  } | {
    type: "chat";
    input: { message: string };
  };
  strategyId?: string;
  connectionConfig?: {
    host: string;
    username: string;
    port?: number;
    auth?: "offline";
  };
  coordinateHint?: { x: number; y: number; z: number };
  discord?: {
    channelId?: string;
    authorId?: string;
    messageId?: string;
  };
} | null {
  const candidate = [...experiences].reverse().find((experience) => {
    if (experience.sourceKind !== "discord") return false;
    const content = payloadText(experience.payload, "content");
    if (!content) return false;
    return /(钻石|diamond|铁|iron)/i.test(content) &&
      (/挖|采|弄|找|帮我|可以吗|mine|collect|get/i.test(content) ||
        resolveCoordinateHint(content) !== null) ||
      isMinecraftCommandProbe(content);
  });
  if (!candidate) return null;

  const summary = payloadText(candidate.payload, "content") ?? candidate.summary;
  const commandProbe = isMinecraftCommandProbe(summary);
  const block = resolveMinecraftBlock(summary);
  const port = resolveMinecraftPort(summary);
  const coordinateHint = resolveCoordinateHint(summary) ?? undefined;

  return {
    experienceId: candidate.id,
    summary,
    action: commandProbe
      ? {
          type: "chat",
          input: {
            message: "/say Stelle command bridge online.",
          },
        }
      : {
          type: "collect_blocks",
          input: {
            block,
            count: 3,
            range: 128,
          },
        },
    strategyId: !commandProbe && block === "iron_ore" ? "iron_prospect" : undefined,
    coordinateHint,
    discord: {
      channelId: payloadText(candidate.payload, "channelId") ?? undefined,
      authorId: payloadText(candidate.payload, "authorId") ?? undefined,
      messageId: payloadText(candidate.payload, "messageId") ?? undefined,
    },
    connectionConfig: port
      ? {
          host: "127.0.0.1",
          port,
          username: process.env.MINECRAFT_USERNAME?.trim() || "Stelle",
          auth: "offline",
        }
      : undefined,
  };
}

function isMinecraftCommandProbe(content: string): boolean {
  return /minecraft|mc|服务器|局域网/i.test(content) &&
    /指令|命令|command|输入|敲|执行|直接/i.test(content);
}

function resolveCoordinateHint(content: string): { x: number; y: number; z: number } | null {
  const match = content.match(/(?:位置|坐标|大概|near|at)?\D*(-?\d{1,5})\D+(-?\d{1,5})\D+(-?\d{1,5})/i);
  if (!match) return null;
  const [x, y, z] = match.slice(1, 4).map(Number);
  if ([x, y, z].some((value) => Number.isNaN(value))) return null;
  return { x, y, z };
}

function resolveMinecraftBlock(content: string): string {
  if (/铁|iron/i.test(content)) return "iron_ore";
  if (/钻石|diamond/i.test(content)) return "diamond_ore";
  return "stone";
}

function resolveMinecraftPort(content: string): number | null {
  const match = content.match(/(?:局域网|局域联机|端口|port|:)[^\d]{0,8}(\d{2,5})/i);
  if (!match) return null;
  const port = Number(match[1]);
  return port > 0 && port <= 65535 ? port : null;
}

function payloadText(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}
