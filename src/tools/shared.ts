import type { ToolResult, ToolSideEffectProfile } from "../types.js";

export function ok(summary: string, data?: Record<string, unknown>): ToolResult {
  return { ok: true, summary, data };
}

export function fail(code: string, message: string): ToolResult {
  return {
    ok: false,
    summary: message,
    error: { code, message, retryable: false },
  };
}

export function sideEffects(overrides?: Partial<ToolSideEffectProfile>): ToolSideEffectProfile {
  return {
    externalVisible: false,
    writesFileSystem: false,
    networkAccess: false,
    startsProcess: false,
    changesConfig: false,
    consumesBudget: false,
    affectsUserState: false,
    ...overrides,
  };
}
