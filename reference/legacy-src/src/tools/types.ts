import type { z } from "zod";

export type ToolAuthority = "readonly" | "safe_write" | "network_read" | "external_write" | "system";
export type ToolCaller = "cursor" | "runtime" | "debug" | "system" | "core" | "stage_renderer";

export interface ToolSideEffectProfile {
  externalVisible: boolean;
  writesFileSystem: boolean;
  networkAccess: boolean;
  startsProcess: boolean;
  changesConfig: boolean;
  consumesBudget: boolean;
  affectsUserState: boolean;
}

export interface ToolContext {
  caller: ToolCaller;
  cursorId?: string;
  allowedAuthority: ToolAuthority[];
  allowedTools?: string[];
  cwd: string;
  signal?: AbortSignal;
  debugBypassStageOutput?: boolean;
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ToolSideEffect {
  type: string;
  summary: string;
  visible: boolean;
  timestamp: number;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
  error?: ToolError;
  sideEffects?: ToolSideEffect[];
}

export interface ToolDefinition<TSchema extends z.AnyZodObject = z.AnyZodObject> {
  name: string;
  title: string;
  description: string;
  authority: ToolAuthority;
  inputSchema: TSchema;
  sideEffects: ToolSideEffectProfile;
  execute(input: z.infer<TSchema>, context: ToolContext): Promise<ToolResult> | ToolResult;
}

export interface ToolAuditRecord {
  id: string;
  toolName: string;
  caller: ToolCaller;
  cursorId?: string;
  authority: ToolAuthority;
  inputSummary: string;
  resultSummary: string;
  ok: boolean;
  startedAt: number;
  finishedAt: number;
  sideEffects: ToolSideEffect[];
}

export function ok(summary: string, data?: Record<string, unknown>): ToolResult {
  return { ok: true, summary, data };
}

export function fail(code: string, message: string, retryable = false): ToolResult {
  return { ok: false, summary: message, error: { code, message, retryable } };
}

export function sideEffects(overrides: Partial<ToolSideEffectProfile> = {}): ToolSideEffectProfile {
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
