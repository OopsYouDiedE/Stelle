import { discordTextChannelCursorModule } from "./modules/discord-text-channel/manifest.js";
import { innerCursorModule } from "./modules/inner/manifest.js";
import { liveDanmakuCursorModule } from "./modules/live-danmaku/manifest.js";
import { browserCursorModule } from "./modules/browser/manifest.js";
import { desktopInputCursorModule } from "./modules/desktop-input/manifest.js";
import type { StartMode } from "../core/application.js";
import type { RuntimeConfig } from "../utils/config_loader.js";
import type { CursorModuleDefinition } from "./manifest.js";

export const cursorModules: CursorModuleDefinition[] = [
  innerCursorModule,
  discordTextChannelCursorModule,
  liveDanmakuCursorModule,
  browserCursorModule,
  desktopInputCursorModule,
];

export function isCursorEnabledByConfig(moduleId: string, rawConfig: Record<string, unknown>): boolean {
  const cursors = rawConfig.cursors;
  if (!cursors || typeof cursors !== "object") return true;
  const entry = (cursors as Record<string, unknown>)[moduleId];
  if (!entry || typeof entry !== "object") return true;
  return (entry as Record<string, unknown>).enabled !== false;
}

export interface CursorModuleSelection {
  mode: StartMode;
  config: RuntimeConfig;
  liveAvailable?: boolean;
}

export function selectCursorModules({ mode, config, liveAvailable = true }: CursorModuleSelection): CursorModuleDefinition[] {
  return cursorModules
    .filter(module => module.enabledInModes.includes(mode))
    .filter(module => isCursorModuleEnabled(module.id, config))
    .filter(module => hasRequiredRuntime(module, config, liveAvailable));
}

function isCursorModuleEnabled(moduleId: string, config: RuntimeConfig): boolean {
  if (moduleId === "browser") return config.browser.enabled;
  if (moduleId === "desktop_input") return config.desktopInput.enabled;
  return isCursorEnabledByConfig(moduleId, config.rawYaml);
}

function hasRequiredRuntime(module: CursorModuleDefinition, config: RuntimeConfig, liveAvailable: boolean): boolean {
  if (!module.requires) return true;
  return module.requires.every(req => {
    if (req === "discord") return Boolean(config.discord.token);
    if (req === "live") return liveAvailable;
    if (req === "browser") return config.browser.enabled;
    if (req === "desktop_input") return config.desktopInput.enabled;
    return false;
  });
}
