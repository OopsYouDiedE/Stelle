import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../../agent/types.js";

interface SearchFilesParams {
  query: string;
  directory_path?: string;
  max_results?: number;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const parts = await Promise.all(
    entries
      .filter((entry) => !["node_modules", ".git", "dist"].includes(entry.name))
      .map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          return walk(fullPath);
        }
        return [fullPath];
      })
  );
  return parts.flat();
}

const searchFilesTool: ToolDefinition<SearchFilesParams> = {
  schema: {
    type: "function",
    function: {
      name: "search_files",
      description: "Search workspace text files for a substring and return matching lines.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Substring to search for.",
          },
          directory_path: {
            type: "string",
            description: "Optional directory relative to the workspace root.",
          },
          max_results: {
            type: "integer",
            description: "Maximum number of matches to return. Default 20.",
          },
        },
        required: ["query"],
      },
    },
  },
  async execute({ query, directory_path, max_results = 20 }, context) {
    const cwd = context?.cwd ?? process.cwd();
    const root = directory_path ? path.resolve(cwd, directory_path) : cwd;
    const files = await walk(root);
    const matches: string[] = [];

    for (const file of files) {
      if (matches.length >= max_results) break;
      let content: string;
      try {
        content = await readFile(file, "utf8");
      } catch {
        continue;
      }

      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index]?.includes(query)) {
          matches.push(`${path.relative(cwd, file)}:${index + 1}: ${lines[index]}`);
          if (matches.length >= max_results) break;
        }
      }
    }

    return matches.length ? matches.join("\n") : `No matches found for "${query}".`;
  },
};

export default searchFilesTool;
