import type { CursorRegistry } from "../core/CursorRegistry.js";
import type { ToolDefinition } from "../types.js";
import { createObsTools } from "./live_tools/obsTools.js";
import { createLiveSpeechTools } from "./live_tools/speechTools.js";
import { createLiveStageTools } from "./live_tools/stageTools.js";
import { createLiveStatusTools } from "./live_tools/statusTools.js";
import type { LiveCursorToolsOptions } from "./live_tools/shared.js";

export type { LiveCursorToolsOptions } from "./live_tools/shared.js";

export function createLiveCursorTools(
  cursors: CursorRegistry,
  options: LiveCursorToolsOptions = {}
): ToolDefinition[] {
  return [
    ...createLiveStatusTools(cursors),
    ...createLiveStageTools(cursors),
    ...createObsTools(cursors),
    ...createLiveSpeechTools(cursors, options),
  ];
}
