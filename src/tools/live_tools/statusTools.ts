import type { CursorRegistry } from "../../core/CursorRegistry.js";
import type { ToolDefinition } from "../../types.js";
import { sanitizeExternalText } from "../../text/sanitize.js";
import { getLiveCursor, isLiveCursor, readOnlySideEffects, resultToToolResult } from "./shared.js";

export function createLiveStatusTools(cursors: CursorRegistry): ToolDefinition[] {
  const statusTool: ToolDefinition = {
    identity: { namespace: "live", name: "cursor_status", authorityClass: "cursor", version: "0.1.0" },
    description: {
      summary: "Reads Live Cursor stage and OBS status.",
      whenToUse: "Use to inspect the local Live2D/OBS host state.",
    },
    inputSchema: { type: "object", properties: {} },
    sideEffects: readOnlySideEffects(true),
    authority: { level: "read", scopes: ["live"], requiresUserConfirmation: false },
    async execute(_input, context) {
      const cursor = getLiveCursor(cursors, context.cursorId);
      if (!isLiveCursor(cursor)) return cursor;
      const status = await cursor.live.getStatus();
      return {
        ok: true,
        summary: `Live status: active=${status.active}, model=${status.stage.model?.id ?? "none"}, obsStreaming=${status.obs.streaming}`,
        data: { status },
      };
    },
  };

  const getStageTool: ToolDefinition = {
    identity: { namespace: "live", name: "cursor_get_stage", authorityClass: "cursor", version: "0.1.0" },
    description: {
      summary: "Reads current Live2D stage state.",
      whenToUse: "Use when a Cursor needs to inspect model, motion, caption, or interaction state.",
    },
    inputSchema: { type: "object", properties: {} },
    sideEffects: readOnlySideEffects(false),
    authority: { level: "read", scopes: ["live.stage"], requiresUserConfirmation: false },
    async execute(_input, context) {
      const cursor = getLiveCursor(cursors, context.cursorId);
      if (!isLiveCursor(cursor)) return cursor;
      const status = await cursor.live.getStatus();
      return {
        ok: true,
        summary: `Read Live2D stage for ${status.stage.model?.id ?? "none"}.`,
        data: { stage: status.stage },
      };
    },
  };

  const captionPreviewTool: ToolDefinition<{ text: string }> = {
    identity: { namespace: "live", name: "cursor_set_caption_preview", authorityClass: "cursor", version: "0.1.0" },
    description: {
      summary: "Updates the Live Cursor caption preview state.",
      whenToUse: "Use for local caption staging before a Stelle-level broadcast action.",
      whenNotToUse: "Do not treat this as a confirmed external broadcast action.",
    },
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Caption text." } },
      required: ["text"],
    },
    sideEffects: { ...readOnlySideEffects(false), affectsUserState: true },
    authority: { level: "local_write", scopes: ["live.caption.preview"], requiresUserConfirmation: false },
    async execute(input, context) {
      const cursor = getLiveCursor(cursors, context.cursorId);
      if (!isLiveCursor(cursor)) return cursor;
      const result = await cursor.live.setCaption(sanitizeExternalText(input.text));
      return {
        ...resultToToolResult(result),
        sideEffects: [
          {
            type: "live_caption_preview",
            summary: "Updated Live Cursor caption preview.",
            visible: false,
            timestamp: Date.now(),
          },
        ],
      };
    },
  };

  return [statusTool, getStageTool, captionPreviewTool];
}
