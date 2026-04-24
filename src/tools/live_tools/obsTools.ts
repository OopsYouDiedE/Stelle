import type { CursorRegistry } from "../../core/CursorRegistry.js";
import type { ToolDefinition } from "../../types.js";
import { getLiveCursor, isLiveCursor, readOnlySideEffects, resultToToolResult } from "./shared.js";

function obsSideEffects() {
  return {
    externalVisible: true,
    writesFileSystem: false,
    networkAccess: true,
    startsProcess: false,
    changesConfig: false,
    consumesBudget: false,
    affectsUserState: true,
  };
}

export function createObsTools(cursors: CursorRegistry): ToolDefinition[] {
  const obsStatusTool: ToolDefinition = {
    identity: { namespace: "live", name: "obs_get_status", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Reads OBS WebSocket streaming and scene status.",
      whenToUse: "Use before starting/stopping stream or changing scene.",
    },
    inputSchema: { type: "object", properties: {} },
    sideEffects: readOnlySideEffects(true),
    authority: { level: "read", scopes: ["obs"], requiresUserConfirmation: false },
    async execute(_input, context) {
      const cursor = getLiveCursor(cursors, context.cursorId);
      if (!isLiveCursor(cursor)) return cursor;
      const status = await cursor.live.obs.getStatus();
      return {
        ok: true,
        summary: `OBS status: enabled=${status.enabled}, connected=${status.connected}, streaming=${status.streaming}`,
        data: { status },
      };
    },
  };

  const obsStartTool: ToolDefinition = {
    identity: { namespace: "live", name: "obs_start_stream", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Starts OBS streaming through OBS WebSocket.",
      whenToUse: "Use when Stelle should begin stream output from OBS.",
    },
    inputSchema: { type: "object", properties: {} },
    sideEffects: obsSideEffects(),
    authority: { level: "external_write", scopes: ["obs.stream"], requiresUserConfirmation: false },
    async execute(_input, context) {
      const cursor = getLiveCursor(cursors, context.cursorId);
      if (!isLiveCursor(cursor)) return cursor;
      const result = await cursor.live.obs.startStream();
      return {
        ...resultToToolResult(result),
        sideEffects: [{ type: "obs_stream_start", summary: result.summary, visible: true, timestamp: Date.now() }],
      };
    },
  };

  const obsStopTool: ToolDefinition = {
    identity: { namespace: "live", name: "obs_stop_stream", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Stops OBS streaming through OBS WebSocket.",
      whenToUse: "Use when Stelle should end stream output from OBS.",
    },
    inputSchema: { type: "object", properties: {} },
    sideEffects: obsSideEffects(),
    authority: { level: "external_write", scopes: ["obs.stream"], requiresUserConfirmation: false },
    async execute(_input, context) {
      const cursor = getLiveCursor(cursors, context.cursorId);
      if (!isLiveCursor(cursor)) return cursor;
      const result = await cursor.live.obs.stopStream();
      return {
        ...resultToToolResult(result),
        sideEffects: [{ type: "obs_stream_stop", summary: result.summary, visible: true, timestamp: Date.now() }],
      };
    },
  };

  const obsSceneTool: ToolDefinition<{ scene_name: string }> = {
    identity: { namespace: "live", name: "obs_set_scene", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Switches the current OBS program scene.",
      whenToUse: "Use when Stelle should switch stream layout or scene.",
    },
    inputSchema: {
      type: "object",
      properties: { scene_name: { type: "string", description: "OBS scene name." } },
      required: ["scene_name"],
    },
    sideEffects: obsSideEffects(),
    authority: { level: "external_write", scopes: ["obs.scene"], requiresUserConfirmation: false },
    async execute(input, context) {
      const cursor = getLiveCursor(cursors, context.cursorId);
      if (!isLiveCursor(cursor)) return cursor;
      const result = await cursor.live.obs.setCurrentScene(input.scene_name);
      return {
        ...resultToToolResult(result),
        sideEffects: [{ type: "obs_scene_change", summary: result.summary, visible: true, timestamp: Date.now() }],
      };
    },
  };

  return [obsStatusTool, obsStartTool, obsStopTool, obsSceneTool];
}
