import type { CursorRegistry } from "../../core/CursorRegistry.js";
import type { Live2DMotionPriority } from "../../live/types.js";
import { sanitizeExternalText } from "../../text/sanitize.js";
import type { ToolDefinition, ToolResult } from "../../types.js";
import { getLiveCursor, isLiveCursor, resultToToolResult } from "./shared.js";

const STAGE_SIDE_EFFECTS = {
  externalVisible: true,
  writesFileSystem: false,
  networkAccess: false,
  startsProcess: false,
  changesConfig: false,
  consumesBudget: false,
  affectsUserState: true,
} as const;

async function executeLiveStageAction<TInput>(
  cursors: CursorRegistry,
  context: { cursorId?: string },
  input: TInput,
  action: (cursor: ReturnType<typeof getLiveCursor> extends infer T ? Exclude<T, ToolResult> : never, input: TInput) => Promise<ToolResult>
): Promise<ToolResult> {
  const cursor = getLiveCursor(cursors, context.cursorId);
  if (!isLiveCursor(cursor)) return cursor;
  return action(cursor, input);
}

export function createLiveStageTools(cursors: CursorRegistry): ToolDefinition[] {
  const loadModelTool: ToolDefinition<{ model_id: string }> = {
    identity: { namespace: "live", name: "stelle_load_model", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Loads a registered Live2D model into the Live Cursor runtime.",
      whenToUse: "Use when Core Mind should switch the visible Live2D model.",
    },
    inputSchema: {
      type: "object",
      properties: { model_id: { type: "string", description: "Registered model id, e.g. Hiyori or Hiyori_pro." } },
      required: ["model_id"],
    },
    sideEffects: STAGE_SIDE_EFFECTS,
    authority: { level: "external_write", scopes: ["live2d.stage"], requiresUserConfirmation: false },
    async execute(input, context) {
      return executeLiveStageAction(cursors, context, input, async (cursor, currentInput) => ({
        ...resultToToolResult(await cursor.live.loadModel(currentInput.model_id)),
        sideEffects: [{ type: "live2d_model_change", summary: `Loaded ${currentInput.model_id}.`, visible: true, timestamp: Date.now() }],
      }));
    },
  };

  const motionTool: ToolDefinition<{ group: string; priority?: Live2DMotionPriority }> = {
    identity: { namespace: "live", name: "stelle_trigger_motion", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Triggers a Live2D motion group.",
      whenToUse: "Use when Stelle should make the Live2D model react visibly.",
    },
    inputSchema: {
      type: "object",
      properties: {
        group: { type: "string", description: "Motion group, e.g. Tap, Flick, Idle." },
        priority: { type: "string", description: "idle, normal, or force." },
      },
      required: ["group"],
    },
    sideEffects: STAGE_SIDE_EFFECTS,
    authority: { level: "external_write", scopes: ["live2d.motion"], requiresUserConfirmation: false },
    async execute(input, context) {
      return executeLiveStageAction(cursors, context, input, async (cursor, currentInput) => {
        const result = await cursor.live.triggerMotion(currentInput.group, currentInput.priority ?? "normal");
        return {
          ...resultToToolResult(result),
          sideEffects: [{ type: "live2d_motion", summary: result.summary, visible: true, timestamp: Date.now() }],
        };
      });
    },
  };

  const expressionTool: ToolDefinition<{ expression: string }> = {
    identity: { namespace: "live", name: "stelle_set_expression", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Sets a Live2D expression name in the runtime state.",
      whenToUse: "Use when Stelle should alter the model expression.",
    },
    inputSchema: {
      type: "object",
      properties: { expression: { type: "string", description: "Expression identifier." } },
      required: ["expression"],
    },
    sideEffects: STAGE_SIDE_EFFECTS,
    authority: { level: "external_write", scopes: ["live2d.expression"], requiresUserConfirmation: false },
    async execute(input, context) {
      return executeLiveStageAction(
        cursors,
        context,
        input,
        async (cursor, currentInput) => resultToToolResult(await cursor.live.setExpression(currentInput.expression))
      );
    },
  };

  const captionTool: ToolDefinition<{ text: string }> = {
    identity: { namespace: "live", name: "stelle_set_caption", authorityClass: "stelle", version: "0.1.0" },
    description: { summary: "Sets the live caption text.", whenToUse: "Use when Stelle should show a caption in the live host." },
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Caption text." } },
      required: ["text"],
    },
    sideEffects: STAGE_SIDE_EFFECTS,
    authority: { level: "external_write", scopes: ["live.caption"], requiresUserConfirmation: false },
    async execute(input, context) {
      return executeLiveStageAction(cursors, context, input, async (cursor, currentInput) => {
        const result = await cursor.live.setCaption(sanitizeExternalText(currentInput.text));
        return {
          ...resultToToolResult(result),
          sideEffects: [{ type: "live_caption", summary: result.summary, visible: true, timestamp: Date.now() }],
        };
      });
    },
  };

  const backgroundTool: ToolDefinition<{ source: string }> = {
    identity: { namespace: "live", name: "stelle_set_background", authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: "Sets the live renderer background image, URL, file path, data URL, or CSS background.",
      whenToUse: "Use when Stelle should change the OBS live background behind the Live2D model.",
    },
    inputSchema: {
      type: "object",
      properties: { source: { type: "string", description: "Background URL/path/data URL/CSS background." } },
      required: ["source"],
    },
    sideEffects: STAGE_SIDE_EFFECTS,
    authority: { level: "external_write", scopes: ["live.background"], requiresUserConfirmation: false },
    async execute(input, context) {
      return executeLiveStageAction(cursors, context, input, async (cursor, currentInput) => {
        const result = await cursor.live.setBackground(currentInput.source);
        return {
          ...resultToToolResult(result),
          sideEffects: [{ type: "live_background", summary: result.summary, visible: true, timestamp: Date.now() }],
        };
      });
    },
  };

  return [loadModelTool, motionTool, expressionTool, captionTool, backgroundTool];
}
