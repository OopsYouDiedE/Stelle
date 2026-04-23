import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../../agent/types.js";

interface ReadFileParams {
  file_path: string;
  start_line?: number;
  end_line?: number;
}

const readFileTool: ToolDefinition<ReadFileParams> = {
  schema: {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file from the workspace, optionally with a line range.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the text file, relative to the workspace root.",
          },
          start_line: {
            type: "integer",
            description: "1-based starting line number.",
          },
          end_line: {
            type: "integer",
            description: "1-based ending line number, inclusive.",
          },
        },
        required: ["file_path"],
      },
    },
  },
  async execute({ file_path, start_line = 1, end_line }, context) {
    const cwd = context?.cwd ?? process.cwd();
    const resolved = path.resolve(cwd, file_path);
    const content = await readFile(resolved, "utf8");
    const lines = content.split(/\r?\n/);
    const last = end_line ? Math.min(end_line, lines.length) : lines.length;
    const slice = lines.slice(start_line - 1, last);

    return [
      `FILE: ${path.relative(cwd, resolved)}`,
      `LINES: ${start_line}-${last} / ${lines.length}`,
      "",
      ...slice.map((line, index) => `${String(start_line + index).padStart(4, " ")} | ${line}`),
    ].join("\n");
  },
};

export default readFileTool;
