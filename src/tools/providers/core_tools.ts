import { exec } from "node:child_process";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { safeErrorMessage } from "../../utils/json.js";
import { ok, fail, sideEffects } from "../types.js";
import type { ToolDefinition, ToolResult } from "../types.js";
import { atomicWrite, workspacePath } from "./workspace.js";

const SAFE_EXPR = /^[0-9+\-*/().,%\s]+$/;

export function createCoreTools(): ToolDefinition[] {
  return [
    {
      name: "basic.datetime",
      title: "Current Date/Time",
      description: "Read the current local date and time.",
      authority: "readonly",
      inputSchema: z.object({}),
      sideEffects: sideEffects(),
      execute() {
        const now = new Date();
        return ok("Current datetime read.", {
          iso: now.toISOString(),
          local: now.toString(),
          timestamp: now.getTime(),
        });
      },
    },
    {
      name: "basic.calculate",
      title: "Basic Calculator",
      description: "Evaluate a basic arithmetic expression.",
      authority: "readonly",
      inputSchema: z.object({ expression: z.string() }),
      sideEffects: sideEffects(),
      execute(input) {
        if (!SAFE_EXPR.test(input.expression))
          return fail("unsupported_expression", "Only basic arithmetic is allowed.");
        try {
          const value = Function(`"use strict"; return (${input.expression});`)() as number;
          return Number.isFinite(value)
            ? ok(String(value), { value })
            : fail("non_finite", "Expression did not produce a finite number.");
        } catch (error) {
          return fail("calculation_failed", safeErrorMessage(error));
        }
      },
    },
    {
      name: "fs.list_directory",
      title: "List Directory",
      description: "List entries in a workspace directory.",
      authority: "readonly",
      inputSchema: z.object({ directory_path: z.string().optional().default(".") }),
      sideEffects: sideEffects(),
      async execute(input, context) {
        const cwd = path.resolve(context.cwd);
        const target = workspacePath(context, input.directory_path);
        const entries = await readdir(target, { withFileTypes: true });
        const items = await Promise.all(
          entries
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(async (entry) => {
              const fullPath = path.join(target, entry.name);
              const info = await stat(fullPath);
              return {
                kind: entry.isDirectory() ? "dir" : "file",
                size: info.size,
                path: path.relative(cwd, fullPath) || entry.name,
              };
            }),
        );
        return ok(`Listed ${items.length} entries.`, { items });
      },
    },
    {
      name: "fs.read_file",
      title: "Read File",
      description: "Read a UTF-8 workspace file.",
      authority: "readonly",
      inputSchema: z.object({
        file_path: z.string(),
        start_line: z.number().int().optional(),
        end_line: z.number().int().optional(),
      }),
      sideEffects: sideEffects(),
      async execute(input, context) {
        const target = workspacePath(context, input.file_path);
        const content = await readFile(target, "utf8");
        const lines = content.split(/\r?\n/);
        const start = Math.max(1, input.start_line ?? 1);
        const end = Math.min(lines.length, input.end_line ?? lines.length);
        return ok(`Read ${end - start + 1} lines.`, {
          filePath: path.relative(context.cwd, target),
          startLine: start,
          endLine: end,
          totalLines: lines.length,
          content: lines.slice(start - 1, end).join("\n"),
        });
      },
    },
    {
      name: "fs.write_file",
      title: "Write File",
      description: "Write a UTF-8 workspace file atomically.",
      authority: "safe_write",
      inputSchema: z.object({ file_path: z.string(), content: z.string() }),
      sideEffects: sideEffects({ writesFileSystem: true }),
      async execute(input, context) {
        const target = workspacePath(context, input.file_path);
        await mkdir(path.dirname(target), { recursive: true });
        await atomicWrite(target, input.content);
        return {
          ...ok(`Wrote ${path.relative(context.cwd, target)}.`, { chars: input.content.length }),
          sideEffects: [
            { type: "file_write", summary: "Wrote workspace file.", visible: false, timestamp: Date.now() },
          ],
        };
      },
    },
    {
      name: "system.run_command",
      title: "Run Command",
      description: "Run a workspace shell command.",
      authority: "system",
      inputSchema: z.object({ command: z.string(), timeout_ms: z.number().int().optional().default(20000) }),
      sideEffects: sideEffects({ startsProcess: true }),
      execute(input, context) {
        return new Promise<ToolResult>((resolve) => {
          exec(
            input.command,
            {
              cwd: context.cwd,
              timeout: input.timeout_ms,
              windowsHide: true,
              encoding: "utf8",
              maxBuffer: 1024 * 1024,
            },
            (error, stdout, stderr) => {
              resolve({
                ok: !error,
                summary: error ? `Command failed with exit code ${error.code ?? "unknown"}.` : "Command completed.",
                data: { stdout, stderr, exitCode: error?.code ?? 0 },
                error: error ? { code: "command_failed", message: error.message, retryable: false } : undefined,
                sideEffects: [
                  { type: "process", summary: "Ran shell command.", visible: false, timestamp: Date.now() },
                ],
              });
            },
          );
        });
      },
    },
  ];
}
