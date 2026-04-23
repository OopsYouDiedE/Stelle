import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../../agent/types.js";

interface ListDirectoryParams {
  directory_path?: string;
}

const listDirectoryTool: ToolDefinition<ListDirectoryParams> = {
  schema: {
    type: "function",
    function: {
      name: "list_directory",
      description: "List files and directories inside a path relative to the project workspace.",
      parameters: {
        type: "object",
        properties: {
          directory_path: {
            type: "string",
            description: "Directory path to inspect. Defaults to the workspace root.",
          },
        },
      },
    },
  },
  async execute({ directory_path }, context) {
    const cwd = context?.cwd ?? process.cwd();
    const target = directory_path ? path.resolve(cwd, directory_path) : cwd;
    const entries = await readdir(target, { withFileTypes: true });
    const rendered = await Promise.all(
      entries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(async (entry) => {
          const fullPath = path.join(target, entry.name);
          const info = await stat(fullPath);
          const kind = entry.isDirectory() ? "dir" : "file";
          return `${kind}\t${info.size}\t${path.relative(cwd, fullPath) || entry.name}`;
        })
    );
    return rendered.join("\n") || "(empty directory)";
  },
};

export default listDirectoryTool;
