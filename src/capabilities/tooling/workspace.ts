import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolContext } from "./types.js";

export function workspacePath(context: ToolContext, filePath?: string): string {
  const cwd = path.resolve(context.cwd);
  const target = path.resolve(cwd, filePath ?? ".");
  if (target !== cwd && !target.startsWith(cwd + path.sep)) throw new Error(`Path is outside workspace: ${target}`);
  return target;
}

export async function atomicWrite(file: string, content: string): Promise<void> {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, "utf8");
  await import("node:fs/promises").then((f) => f.rename(temp, file));
}
