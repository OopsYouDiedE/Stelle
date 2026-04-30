import { discordTextChannelCursorModule } from "./modules/discord-text-channel/manifest.js";
import { innerCursorModule } from "./modules/inner/manifest.js";
import { liveDanmakuCursorModule } from "./modules/live-danmaku/manifest.js";
import { browserCursorModule } from "./modules/browser/manifest.js";
import { desktopInputCursorModule } from "./modules/desktop-input/manifest.js";
import type { StartMode } from "../core/application.js";
import type { RuntimeConfig } from "../config/index.js";
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
  const entries = cursorConfigEntries(moduleId, cursors as Record<string, unknown>);
  const explicit = [...entries].reverse().find(entry => Object.prototype.hasOwnProperty.call(entry, "enabled"));
  return explicit ? explicit.enabled !== false : true;
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
  if (moduleId === "discord_text_channel") return config.discord.enabled;
  if (moduleId === "live_danmaku") return config.live.enabled;
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

function cursorConfigEntries(moduleId: string, cursors: Record<string, unknown>): Record<string, unknown>[] {
  const aliases: Record<string, string[]> = {
    discord_text_channel: ["discord"],
    live_danmaku: ["live"],
    desktop_input: ["desktopInput"],
  };
  return [...(aliases[moduleId] ?? []), moduleId]
    .map(key => cursors[key])
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
}
