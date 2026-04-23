import type { ToolDefinition } from "../types.js";

export const echoTool: ToolDefinition<{ text: string }> = {
  identity: {
    namespace: "test",
    name: "echo",
    authorityClass: "cursor",
    version: "0.1.0",
  },
  description: {
    summary: "Echoes low-risk test text.",
    whenToUse: "Use only for architecture tests and local passive cursor checks.",
  },
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Text to echo." },
    },
    required: ["text"],
  },
  sideEffects: {
    externalVisible: false,
    writesFileSystem: false,
    networkAccess: false,
    startsProcess: false,
    changesConfig: false,
    consumesBudget: false,
    affectsUserState: false,
  },
  authority: {
    level: "read",
    scopes: ["test"],
    requiresUserConfirmation: false,
  },
  execute(input) {
    return {
      ok: true,
      summary: `echo: ${input.text}`,
      data: { text: input.text },
      sideEffects: [],
    };
  },
};
