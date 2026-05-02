import { asRecord } from "../../../shared/json.js";

export interface AndroidConfig {
  enabled: boolean;
  allowlist?: {
    cursors?: string[];
    resources?: string[];
    resourceKinds?: string[];
    risks?: string[];
  };
}

export function loadAndroidConfig(rawYaml: Record<string, unknown> = {}): AndroidConfig {
  const cursors = asRecord(rawYaml.cursors);
  const androidCursor = asRecord(cursors.android || cursors.android_device || cursors.androidDevice);

  return {
    enabled: androidCursor.enabled === true || process.env.ANDROID_DEVICE_ENABLED === "true",
    allowlist: asRecord(androidCursor.allowlist) as any,
  };
}
