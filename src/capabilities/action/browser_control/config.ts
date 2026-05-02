import { asRecord } from "../../../shared/json.js";

export interface BrowserConfig {
  enabled: boolean;
  allowlist?: {
    cursors?: string[];
    resources?: string[];
    resourceKinds?: string[];
    risks?: string[];
  };
}

export function loadBrowserConfig(rawYaml: Record<string, unknown> = {}): BrowserConfig {
  const cursors = asRecord(rawYaml.cursors);
  const browserCursor = asRecord(cursors.browser);

  return {
    enabled: browserCursor.enabled === true || process.env.BROWSER_ENABLED === "true",
    allowlist: asRecord(browserCursor.allowlist) as any,
  };
}
