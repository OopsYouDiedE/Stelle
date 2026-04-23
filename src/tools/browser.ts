import type { ToolDefinition, ToolResult } from "../types.js";

const browserToolNames = [
  "go_back",
  "click_element",
  "human_wait",
  "keyboard_press",
  "keyboard_type",
  "mouse_click",
  "open_page",
  "read_page",
  "refresh_page",
  "screenshot",
  "type_into",
];

function unavailable(name: string): ToolResult {
  return {
    ok: false,
    summary: `Browser tool browser.${name} is registered but unavailable because Browser Cursor is not implemented in the new src yet.`,
    error: {
      code: "browser_cursor_unavailable",
      message: `Browser tool browser.${name} requires a Browser Cursor implementation.`,
      retryable: false,
    },
  };
}

export function createBrowserCompatibilityTools(): ToolDefinition[] {
  return browserToolNames.map((name) => ({
    identity: { namespace: "browser", name, authorityClass: "stelle", version: "0.1.0" },
    description: {
      summary: `Compatibility registration for old browser.${name}.`,
      whenToUse: "Use only after Browser Cursor has been implemented and attached.",
      whenNotToUse: "Do not rely on this compatibility placeholder for real browser automation.",
    },
    inputSchema: { type: "object", properties: {} },
    sideEffects: {
      externalVisible: false,
      writesFileSystem: false,
      networkAccess: true,
      startsProcess: false,
      changesConfig: false,
      consumesBudget: false,
      affectsUserState: true,
    },
    authority: { level: "external_write", scopes: ["browser"], requiresUserConfirmation: false },
    execute: () => unavailable(name),
  }));
}
