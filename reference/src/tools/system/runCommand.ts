import { exec } from "node:child_process";
import type { ToolDefinition } from "../../agent/types.js";

interface RunCommandParams {
  command: string;
  timeout_ms?: number;
}

const runCommandTool: ToolDefinition<RunCommandParams> = {
  schema: {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command in the workspace and return stdout and stderr.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Shell command to execute.",
          },
          timeout_ms: {
            type: "integer",
            description: "Optional timeout in milliseconds. Defaults to 20000.",
          },
        },
        required: ["command"],
      },
    },
  },
  execute({ command, timeout_ms = 20000 }, context) {
    const cwd = context?.cwd ?? process.cwd();
    return new Promise<string>((resolve) => {
      exec(
        command,
        {
          cwd,
          timeout: timeout_ms,
          windowsHide: true,
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
        },
        (error, stdout, stderr) => {
          const output = [stdout?.trim(), stderr?.trim()].filter(Boolean).join("\n");
          if (error) {
            resolve(
              [
                `Exit code: ${error.code ?? "unknown"}`,
                output || "(no output)",
              ].join("\n")
            );
            return;
          }
          resolve(output || "(command completed with no output)");
        }
      );
    });
  },
};

export default runCommandTool;
