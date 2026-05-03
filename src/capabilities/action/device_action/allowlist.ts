import type { DeviceActionAllowlist, DeviceActionRisk } from "./types.js";

import { loadBrowserConfig } from "../browser_control/config.js";
import { loadDesktopInputConfig } from "../desktop_input/config.js";
import { loadAndroidConfig } from "../android_device/config.js";

export function buildDeviceActionAllowlist(config: any): DeviceActionAllowlist | undefined {
  const browserConfig = loadBrowserConfig(config.rawYaml);
  const desktopConfig = loadDesktopInputConfig(config.rawYaml);
  const androidConfig = loadAndroidConfig(config.rawYaml);

  const browserEnabled = browserConfig.enabled;
  const desktopEnabled = desktopConfig.enabled;
  const androidEnabled = androidConfig.enabled;
  if (!browserEnabled && !desktopEnabled && !androidEnabled) return undefined;

  const merged: DeviceActionAllowlist = {
    cursors: [],
    resources: [],
    resourceKinds: [],
    risks: [],
  };

  if (browserEnabled) {
    addAll(merged.cursors!, ["browser", ...((browserConfig.allowlist?.cursors as string[] | undefined) ?? [])]);
    addAll(merged.resources!, (browserConfig.allowlist?.resources as string[] | undefined) ?? ["default"]);
    addAll(merged.resourceKinds!, ["browser"]);
    addAll(
      merged.risks!,
      (browserConfig.allowlist?.risks as DeviceActionRisk[] | undefined) ?? [
        "readonly",
        "safe_interaction",
        "text_input",
      ],
    );
  }

  if (desktopEnabled) {
    addAll(merged.cursors!, ["desktop_input", ...((desktopConfig.allowlist?.cursors as string[] | undefined) ?? [])]);
    addAll(merged.resources!, (desktopConfig.allowlist?.resources as string[] | undefined) ?? ["desktop"]);
    addAll(merged.resourceKinds!, ["desktop_input"]);
    addAll(
      merged.risks!,
      (desktopConfig.allowlist?.risks as DeviceActionRisk[] | undefined) ?? [
        "readonly",
        "safe_interaction",
        "text_input",
      ],
    );
  }

  if (androidEnabled) {
    addAll(merged.cursors!, ["android_device", ...((androidConfig.allowlist?.cursors as string[] | undefined) ?? [])]);
    addAll(merged.resources!, (androidConfig.allowlist?.resources as string[] | undefined) ?? ["default"]);
    addAll(merged.resourceKinds!, ["android_device"]);
    addAll(
      merged.risks!,
      (androidConfig.allowlist?.risks as DeviceActionRisk[] | undefined) ?? [
        "readonly",
        "safe_interaction",
        "text_input",
      ],
    );
  }

  return merged;
}

function addAll<T>(target: T[], values?: T[]): void {
  for (const value of values ?? []) {
    if (!target.includes(value)) target.push(value);
  }
}
