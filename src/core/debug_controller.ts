import type { StelleCursor } from "../cursor/types.js";
import type { DeviceActionArbiter } from "../actuator/action_arbiter.js";
import type { StageOutputArbiter } from "../actuator/output_arbiter.js";
import type { ToolRegistry } from "../tool.js";
import type { DiscordRuntime } from "../utils/discord.js";
import type { StelleEventBus } from "../utils/event_bus.js";
import type { LiveRuntime } from "../utils/live.js";
import type { MemoryStore } from "../memory/memory.js";
import type { RuntimeConfig } from "../config/index.js";
import type { LiveRendererServer } from "../live/infra/renderer_server.js";
import type { RuntimeState } from "../runtime_state.js";
import type { LiveHealthService } from "../live/controller/health_service.js";
import type { LiveEventJournal } from "../live/controller/event_journal.js";
import type { ViewerProfileStore } from "../live/controller/viewer_profile.js";
import { normalizeLiveEvent } from "../utils/live_event.js";

export interface RendererControllerDeps {
  renderer: LiveRendererServer;
  config: RuntimeConfig;
  state: RuntimeState;
  cursors: () => StelleCursor[];
  discord: DiscordRuntime;
  live: () => LiveRuntime | undefined;
  memory: MemoryStore;
  tools: ToolRegistry;
  stageOutput: StageOutputArbiter;
  deviceAction: DeviceActionArbiter;
  eventBus: StelleEventBus;
  health?: () => LiveHealthService | undefined;
  journal?: () => LiveEventJournal | undefined;
  viewerProfiles?: ViewerProfileStore;
  runControlCommand?(input: Record<string, unknown>): Promise<unknown> | unknown;
  proposeSystemLiveOutput(source: "debug" | "system", input: Record<string, unknown>): Promise<unknown>;
  now: () => number;
}

export function setupRendererControllers(deps: RendererControllerDeps): void {
  const liveController = {
    sendLiveRequest: async (input: Record<string, unknown>) => {
      return deps.proposeSystemLiveOutput("system", input);
    },
    sendLiveEvent: (input: Record<string, unknown>) => {
      const eventId = `live-event-${deps.now()}`;
      const payload = { id: eventId, ...input };
      const event = normalizeLiveEvent(payload);
      deps.eventBus.publish({
        type: "live.event.received",
        source: "system",
        id: eventId,
        timestamp: deps.now(),
        payload: event,
      } as any);
      deps.eventBus.publish({
        type: "live.danmaku.received",
        source: "system",
        id: eventId,
        timestamp: deps.now(),
        payload: event,
      } as any);
      return { accepted: true, reason: "Forwarded to event bus", eventId };
    },
    getHealth: async () => deps.health?.()?.snapshot() ?? { unavailable: true },
    getJournal: async (limit?: number) => deps.journal?.()?.getRecent(limit) ?? [],
    runControlCommand: async (input: Record<string, unknown>) => {
      if (!deps.runControlCommand) return { ok: false, reason: "control unavailable" };
      return deps.runControlCommand(input);
    },
    getViewerProfile: async (platform: string, viewerId: string) => {
      return deps.viewerProfiles?.read(platform as any, viewerId) ?? null;
    },
    deleteViewerProfile: async (platform: string, viewerId: string) => {
      const deleted = await deps.viewerProfiles?.delete(platform as any, viewerId);
      return { deleted: Boolean(deleted) };
    },
  };

  deps.renderer.setLiveController(liveController);
  deps.renderer.setMemoryController({
    snapshot: () => deps.memory.snapshot(),
    readRecent: (scope, limit) => deps.memory.readRecent(scope, limit),
    search: (scope, input) => deps.memory.searchHistory(scope, input),
    readLongTerm: (key, layer) => deps.memory.readLongTerm(key, layer),
    writeLongTerm: (key, value, layer) => deps.memory.writeLongTerm(key, value, layer),
    appendLongTerm: (key, value, layer) => deps.memory.appendLongTerm(key, value, layer),
    propose: (input) => deps.memory.proposeMemory({
      authorId: input.authorId ?? "control",
      source: input.source ?? "control",
      content: input.content,
      reason: input.reason,
      layer: input.layer ?? "user_facts",
    }),
    listProposals: (input) => deps.memory.listMemoryProposals(input?.limit, input?.status),
    approveProposal: (input) => deps.memory.approveMemoryProposal(input.proposalId, {
      decidedBy: input.decidedBy ?? "control",
      reason: input.reason,
      targetKey: input.targetKey,
    }),
    rejectProposal: (input) => deps.memory.rejectMemoryProposal(input.proposalId, {
      decidedBy: input.decidedBy ?? "control",
      reason: input.reason,
    }),
  });

  if (!deps.config.debug.enabled) {
    deps.state.record("debug_disabled", "Debug controller is disabled by configuration.");
    return;
  }

  deps.renderer.setDebugController({
    getSnapshot: async () => {
      const cursors = deps.cursors();
      deps.state.updateCursors(cursors.map(c => c.snapshot()));
      const innerCursor = cursors.find(c => c.id === "inner");
      if (innerCursor) {
        const snapshot = innerCursor.snapshot();
        deps.state.updateStelleCore({
          lastReflectionAt: Number(snapshot.state.lastCoreReflectionAt),
          currentFocusSummary: String(snapshot.state.currentFocusSummary),
        });
      }

      const [discordStatus, liveStatus, memorySnapshot] = await Promise.all([
        deps.discord.getStatus(),
        deps.live()?.getStatus(),
        deps.memory.snapshot(),
      ]);
      deps.state.updateDiscord({ connected: discordStatus.connected });
      deps.state.updateRenderer({ connected: deps.renderer.getStatus().connected });
      deps.state.updateMemory({
        channelRecentCounts: (memorySnapshot.channelRecentCounts as Record<string, number> | undefined) ?? {},
        researchLogCount: Number(memorySnapshot.researchLogCount ?? 0),
      });
      return {
        runtime: deps.state.snapshot(),
        discord: discordStatus,
        live: liveStatus,
        renderer: deps.renderer.getStatus(),
        stageOutput: deps.stageOutput.snapshot(),
        deviceAction: deps.deviceAction.snapshot(),
        tools: deps.tools.list().map(t => ({ name: t.name, authority: t.authority, title: t.title })),
        audit: deps.tools.audit.slice(-50),
        memory: memorySnapshot,
      };
    },
    useTool: (name, input) => {
      const { _bypassStage, ...toolInput } = input as Record<string, unknown>;
      return deps.tools.execute(name, toolInput, {
        caller: "debug",
        cwd: process.cwd(),
        debugBypassStageOutput: Boolean(_bypassStage),
        allowedAuthority: deps.config.debug.allowExternalWrite
          ? ["readonly", "safe_write", "network_read", "external_write"]
          : ["readonly", "safe_write", "network_read"],
      });
    },
    sendLiveRequest: async (input) => {
      return deps.proposeSystemLiveOutput("debug", input);
    },
    sendLiveEvent: liveController.sendLiveEvent,
  });
}
