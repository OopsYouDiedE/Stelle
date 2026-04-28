import { discordTextChannelCursorModule } from "./modules/discord-text-channel/manifest.js";
import { innerCursorModule } from "./modules/inner/manifest.js";
import { liveDanmakuCursorModule } from "./modules/live-danmaku/manifest.js";
import { browserCursorModule } from "./modules/browser/manifest.js";
import type { CursorModuleDefinition } from "./manifest.js";

export const cursorModules: CursorModuleDefinition[] = [
  innerCursorModule,
  discordTextChannelCursorModule,
  liveDanmakuCursorModule,
  browserCursorModule,
];

export function isCursorEnabledByConfig(moduleId: string, rawConfig: Record<string, unknown>): boolean {
  const cursors = rawConfig.cursors;
  if (!cursors || typeof cursors !== "object") return true;
  const entry = (cursors as Record<string, unknown>)[moduleId];
  if (!entry || typeof entry !== "object") return true;
  return (entry as Record<string, unknown>).enabled !== false;
}
