import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../../agent/types.js";

interface WriteFileParams {
  file_path: string;
  content: string;
}

const writeFileTool: ToolDefinition<WriteFileParams> = {
  schema: {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a UTF-8 text file inside the workspace. Overwrites the target file.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to write, relative to the workspace root.",
          },
          content: {
            type: "string",
            description: "Full file contents to write.",
          },
        },
        required: ["file_path", "content"],
      },
    },
  },
  async execute({ file_path, content }, context) {
    const cwd = context?.cwd ?? process.cwd();
    const resolved = path.resolve(cwd, file_path);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, content, "utf8");
    return `Wrote ${path.relative(cwd, resolved)} (${content.length} chars).`;
  },
};

export default writeFileTool;
