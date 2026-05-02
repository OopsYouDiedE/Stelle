import type { RuntimeConfig } from "../../../config/index.js";
import type { DeviceActionAllowlist, DeviceActionRisk } from "./types.js";

export function buildDeviceActionAllowlist(config: RuntimeConfig): DeviceActionAllowlist | undefined {
  const browserEnabled = config.browser.enabled;
  const desktopEnabled = config.desktopInput.enabled;
  const androidEnabled = config.android.enabled;
  if (!browserEnabled && !desktopEnabled && !androidEnabled) return undefined;

  const merged: DeviceActionAllowlist = {
    cursors: [],
    resources: [],
    resourceKinds: [],
    risks: [],
  };

  if (browserEnabled) {
    addAll(merged.cursors!, ["browser", ...((config.browser.allowlist?.cursors as string[] | undefined) ?? [])]);
    addAll(merged.resources!, (config.browser.allowlist?.resources as string[] | undefined) ?? ["default"]);
    addAll(merged.resourceKinds!, ["browser"]);
    addAll(
      merged.risks!,
      (config.browser.allowlist?.risks as DeviceActionRisk[] | undefined) ?? [
        "readonly",
        "safe_interaction",
        "text_input",
      ],
    );
  }

  if (desktopEnabled) {
    addAll(merged.cursors!, [
      "desktop_input",
      ...((config.desktopInput.allowlist?.cursors as string[] | undefined) ?? []),
    ]);
    addAll(merged.resources!, (config.desktopInput.allowlist?.resources as string[] | undefined) ?? ["desktop"]);
    addAll(merged.resourceKinds!, ["desktop_input"]);
    addAll(
      merged.risks!,
      (config.desktopInput.allowlist?.risks as DeviceActionRisk[] | undefined) ?? [
        "readonly",
        "safe_interaction",
        "text_input",
      ],
    );
  }

  if (androidEnabled) {
    addAll(merged.cursors!, ["android_device", ...((config.android.allowlist?.cursors as string[] | undefined) ?? [])]);
    addAll(merged.resources!, (config.android.allowlist?.resources as string[] | undefined) ?? ["default"]);
    addAll(merged.resourceKinds!, ["android_device"]);
    addAll(
      merged.risks!,
      (config.android.allowlist?.risks as DeviceActionRisk[] | undefined) ?? [
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
