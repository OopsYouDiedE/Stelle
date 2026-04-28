import type { StelleCursor } from "../cursor/types.js";
import type { DeviceActionArbiter } from "../device/action_arbiter.js";
import type { StageOutputArbiter } from "../stage/output_arbiter.js";
import type { ToolRegistry } from "../tool.js";
import type { DiscordRuntime } from "../utils/discord.js";
import type { StelleEventBus } from "../utils/event_bus.js";
import type { LiveRuntime } from "../utils/live.js";
import type { MemoryStore } from "../utils/memory.js";
import type { RuntimeConfig } from "../utils/config_loader.js";
import type { LiveRendererServer } from "../utils/renderer.js";
import type { RuntimeState } from "../runtime_state.js";

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
      deps.eventBus.publish({
        type: "live.danmaku.received",
        source: "system",
        id: eventId,
        timestamp: deps.now(),
        payload: { ...input },
      } as any);
      return { accepted: true, reason: "Forwarded to event bus", eventId };
    },
  };

  deps.renderer.setLiveController(liveController);

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
