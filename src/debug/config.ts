import { asRecord, asString } from "../shared/json.js";

export interface DebugConfig {
  enabled: boolean;
  port: number;
  requireToken: boolean;
  token?: string;
  allowExternalWrite: boolean;
}

export interface ControlConfig {
  requireToken: boolean;
  token?: string;
}

export function loadDebugConfig(rawYaml: Record<string, unknown> = {}): DebugConfig {
  const debug = asRecord(rawYaml.debug);
  const debugToken = process.env.STELLE_DEBUG_TOKEN || asString(debug.token) || undefined;
  const portValue = Number(process.env.STELLE_DEBUG_PORT || debug.port);

  return {
    enabled: process.env.STELLE_DEBUG_ENABLED === "true" || debug.enabled === true,
    port: isNaN(portValue) || portValue === 0 ? 7070 : portValue,
    requireToken: process.env.STELLE_DEBUG_REQUIRE_TOKEN !== "false" && debug.requireToken !== false,
    token: debugToken,
    allowExternalWrite: process.env.STELLE_DEBUG_ALLOW_EXTERNAL_WRITE === "true" || debug.allowExternalWrite === true,
  };
}

export function loadControlConfig(rawYaml: Record<string, unknown> = {}): ControlConfig {
  const control = asRecord(rawYaml.control);
  const debug = asRecord(rawYaml.debug);
  const debugToken = process.env.STELLE_DEBUG_TOKEN || asString(debug.token) || undefined;

  return {
    requireToken: process.env.STELLE_CONTROL_REQUIRE_TOKEN !== "false" && control.requireToken !== false,
    token: process.env.STELLE_CONTROL_TOKEN || asString(control.token) || debugToken,
  };
}
