import { asRecord } from "../../../shared/json.js";

export interface DesktopInputConfig {
  enabled: boolean;
  allowlist?: {
    cursors?: string[];
    resources?: string[];
    resourceKinds?: string[];
    risks?: string[];
  };
}

export function loadDesktopInputConfig(rawYaml: Record<string, unknown> = {}): DesktopInputConfig {
  const cursors = asRecord(rawYaml.cursors);
  const desktopInputCursor = asRecord(cursors.desktop_input || cursors.desktopInput);

  return {
    enabled: desktopInputCursor.enabled === true || process.env.DESKTOP_INPUT_ENABLED === "true",
    allowlist: asRecord(desktopInputCursor.allowlist) as any,
  };
}
