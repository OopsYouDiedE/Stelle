import { exec } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "../types.js";
import { ToolRegistry } from "./ToolRegistry.js";

const SAFE_EXPR = /^[0-9+\-*/().,%\s]+$/;
const todoStores = new Map<string, unknown[]>();

function ok(summary: string, data?: Record<string, unknown>): ToolResult {
  return { ok: true, summary, data };
}

function fail(code: string, message: string): ToolResult {
  return { ok: false, summary: message, error: { code, message, retryable: false } };
}

function workspacePath(context: ToolExecutionContext, filePath?: string): string {
  const cwd = path.resolve(context.cwd ?? process.cwd());
  const target = path.resolve(cwd, filePath ?? ".");
  if (target !== cwd && !target.startsWith(cwd + path.sep)) {
    throw new Error(`Path is outside workspace: ${target}`);
  }
  return target;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !["node_modules", ".git", "dist"].includes(entry.name))
      .map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(fullPath);
        return [fullPath];
      })
  );
  return nested.flat();
}

export function createCoreTools(registry?: ToolRegistry): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      identity: { namespace: "basic", name: "calculate", authorityClass: "cursor", version: "0.1.0" },
      description: { summary: "Evaluate basic arithmetic.", whenToUse: "Use for simple arithmetic expressions." },
      inputSchema: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
      sideEffects: none(false),
      authority: { level: "read", scopes: ["basic"], requiresUserConfirmation: false },
      execute(input) {
        const expression = String(input.expression ?? "");
        if (!SAFE_EXPR.test(expression)) return fail("unsupported_expression", "Only basic arithmetic is allowed.");
        try {
          const value = Function(`"use strict"; return (${expression});`)() as number;
          return Number.isFinite(value) ? ok(String(value), { value }) : fail("non_finite", "Expression did not produce a finite number.");
        } catch (error) {
          return fail("calculation_failed", (error as Error).message);
        }
      },
    },
    {
      identity: { namespace: "basic", name: "datetime", authorityClass: "cursor", version: "0.1.0" },
      description: { summary: "Get current local date/time.", whenToUse: "Use when current runtime time is needed." },
      inputSchema: { type: "object", properties: {} },
      sideEffects: none(false),
      authority: { level: "read", scopes: ["basic"], requiresUserConfirmation: false },
      execute() {
        const now = new Date();
        return ok("Current datetime read.", { iso: now.toISOString(), local: now.toString(), timestamp: now.getTime() });
      },
    },
    {
      identity: { namespace: "fs", name: "list_directory", authorityClass: "cursor", version: "0.1.0" },
      description: { summary: "List workspace directory entries.", whenToUse: "Use to inspect files in the workspace." },
      inputSchema: { type: "object", properties: { directory_path: { type: "string" } } },
      sideEffects: none(false),
      authority: { level: "read", scopes: ["workspace"], requiresUserConfirmation: false },
      async execute(input, context) {
        const cwd = path.resolve(context.cwd ?? process.cwd());
        const target = workspacePath(context, typeof input.directory_path === "string" ? input.directory_path : ".");
        const entries = await readdir(target, { withFileTypes: true });
        const items = await Promise.all(
          entries.sort((a, b) => a.name.localeCompare(b.name)).map(async (entry) => {
            const fullPath = path.join(target, entry.name);
            const info = await stat(fullPath);
            return {
              kind: entry.isDirectory() ? "dir" : "file",
              size: info.size,
              path: path.relative(cwd, fullPath) || entry.name,
            };
          })
        );
        return ok(`Listed ${items.length} entries.`, { items });
      },
    },
    {
      identity: { namespace: "fs", name: "read_file", authorityClass: "cursor", version: "0.1.0" },
      description: { summary: "Read a UTF-8 workspace file.", whenToUse: "Use to inspect text files in the workspace." },
      inputSchema: {
        type: "object",
        properties: { file_path: { type: "string" }, start_line: { type: "integer" }, end_line: { type: "integer" } },
        required: ["file_path"],
      },
      sideEffects: none(false),
      authority: { level: "read", scopes: ["workspace"], requiresUserConfirmation: false },
      async execute(input, context) {
        const target = workspacePath(context, String(input.file_path));
        const content = await readFile(target, "utf8");
        const lines = content.split(/\r?\n/);
        const start = Math.max(1, Number(input.start_line ?? 1));
        const end = Math.min(lines.length, Number(input.end_line ?? lines.length));
        return ok(`Read ${end - start + 1} lines.`, {
          filePath: path.relative(context.cwd ?? process.cwd(), target),
          startLine: start,
          endLine: end,
          totalLines: lines.length,
          content: lines.slice(start - 1, end).join("\n"),
        });
      },
    },
    {
      identity: { namespace: "fs", name: "search_files", authorityClass: "cursor", version: "0.1.0" },
      description: { summary: "Search workspace text files.", whenToUse: "Use to find matching lines in workspace files." },
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" }, directory_path: { type: "string" }, max_results: { type: "integer" } },
        required: ["query"],
      },
      sideEffects: none(false),
      authority: { level: "read", scopes: ["workspace"], requiresUserConfirmation: false },
      async execute(input, context) {
        const cwd = path.resolve(context.cwd ?? process.cwd());
        const root = workspacePath(context, typeof input.directory_path === "string" ? input.directory_path : ".");
        const query = String(input.query);
        const maxResults = Math.max(1, Math.min(100, Number(input.max_results ?? 20)));
        const matches: { filePath: string; line: number; text: string }[] = [];
        for (const file of await walk(root)) {
          if (matches.length >= maxResults) break;
          let content = "";
          try {
            content = await readFile(file, "utf8");
          } catch {
            continue;
          }
          const lines = content.split(/\r?\n/);
          for (let index = 0; index < lines.length && matches.length < maxResults; index++) {
            if (lines[index]?.includes(query)) {
              matches.push({ filePath: path.relative(cwd, file), line: index + 1, text: lines[index]! });
            }
          }
        }
        return ok(`Found ${matches.length} matches.`, { matches });
      },
    },
    {
      identity: { namespace: "fs", name: "write_file", authorityClass: "stelle", version: "0.1.0" },
      description: { summary: "Write a UTF-8 workspace file.", whenToUse: "Use for approved workspace file writes." },
      inputSchema: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } }, required: ["file_path", "content"] },
      sideEffects: { ...none(false), writesFileSystem: true },
      authority: { level: "local_write", scopes: ["workspace"], requiresUserConfirmation: false },
      async execute(input, context) {
        const target = workspacePath(context, String(input.file_path));
        const content = String(input.content ?? "");
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
        return { ...ok(`Wrote ${path.relative(context.cwd ?? process.cwd(), target)}.`, { chars: content.length }), sideEffects: [{ type: "file_write", summary: "Wrote workspace file.", visible: false, timestamp: Date.now() }] };
      },
    },
    {
      identity: { namespace: "system", name: "run_command", authorityClass: "stelle", version: "0.1.0" },
      description: { summary: "Run a workspace shell command.", whenToUse: "Use for approved command execution.", whenNotToUse: "Do not expose to Cursor passive flows." },
      inputSchema: { type: "object", properties: { command: { type: "string" }, timeout_ms: { type: "integer" } }, required: ["command"] },
      sideEffects: { ...none(false), startsProcess: true },
      authority: { level: "process_control", scopes: ["workspace"], requiresUserConfirmation: false },
      execute(input, context) {
        return new Promise<ToolResult>((resolve) => {
          exec(String(input.command), {
            cwd: context.cwd ?? process.cwd(),
            timeout: Number(input.timeout_ms ?? 20000),
            windowsHide: true,
            encoding: "utf8",
            maxBuffer: 1024 * 1024,
          }, (error, stdout, stderr) => {
            resolve({
              ok: !error,
              summary: error ? `Command failed with exit code ${error.code ?? "unknown"}.` : "Command completed.",
              data: { stdout, stderr, exitCode: error?.code ?? 0 },
              error: error ? { code: "command_failed", message: error.message, retryable: false } : undefined,
              sideEffects: [{ type: "process", summary: "Ran shell command.", visible: false, timestamp: Date.now() }],
            });
          });
        });
      },
    },
    {
      identity: { namespace: "memory", name: "todo", authorityClass: "cursor", version: "0.1.0" },
      description: { summary: "Read or replace conversation todos.", whenToUse: "Use for local task tracking." },
      inputSchema: { type: "object", properties: { todos: { type: "array" } } },
      sideEffects: none(false),
      authority: { level: "read", scopes: ["memory.todo"], requiresUserConfirmation: false },
      execute(input, context) {
        const key = context.conversationId ?? context.cursorId ?? "default";
        if (Array.isArray(input.todos)) todoStores.set(key, input.todos);
        return ok("Todo list read.", { todos: todoStores.get(key) ?? [] });
      },
    },
    {
      identity: { namespace: "meta", name: "show_available_tools", authorityClass: "cursor", version: "0.1.0" },
      description: { summary: "List registered tools.", whenToUse: "Use to inspect tool availability." },
      inputSchema: { type: "object", properties: {} },
      sideEffects: none(false),
      authority: { level: "read", scopes: ["meta"], requiresUserConfirmation: false },
      execute() {
        return ok("Available tools listed.", { tools: registry?.list() ?? [] });
      },
    },
  ];
  return tools;
}

function none(networkAccess: boolean) {
  return {
    externalVisible: false,
    writesFileSystem: false,
    networkAccess,
    startsProcess: false,
    changesConfig: false,
    consumesBudget: false,
    affectsUserState: false,
  };
}

export function registerCoreTools(registry: ToolRegistry): void {
  for (const tool of createCoreTools(registry)) {
    registry.register(tool);
  }
}
