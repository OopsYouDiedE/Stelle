import { describe, expect, it, vi } from "vitest";
import { CursorToolExecutor } from "../../src/cursor/tool_executor.js";
import { ToolRegistry, sideEffects } from "../../src/tool.js";
import { z } from "zod";

describe("CursorToolExecutor", () => {
  it("executes whitelisted tools through the shared cursor context", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "memory.search",
      title: "Search",
      description: "Search",
      authority: "readonly",
      inputSchema: z.object({ scope: z.object({ kind: z.string() }) }),
      sideEffects: sideEffects(),
      execute: vi.fn((input) => ({ ok: true, summary: "searched", data: { scope: input.scope } })),
    });

    const executor = new CursorToolExecutor({
      tools: registry,
      cursorId: "live_danmaku",
      allowedAuthority: ["readonly"],
      allowedTools: ["memory.search"],
    });
    const result = await executor.executePlan([{ tool: "memory.search", parameters: { scope: { kind: "live" } } }]);

    expect(result[0]).toMatchObject({ name: "memory.search", ok: true });
    expect(result[0].data?.scope).toEqual({ kind: "live" });
  });

  it("preserves registry whitelist rejection", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "search.web_read",
      title: "Read",
      description: "Read",
      authority: "network_read",
      inputSchema: z.object({ url: z.string() }),
      sideEffects: sideEffects({ networkAccess: true }),
      execute: vi.fn(() => ({ ok: true, summary: "read" })),
    });

    const executor = new CursorToolExecutor({
      tools: registry,
      cursorId: "discord_text_channel",
      allowedAuthority: ["network_read"],
      allowedTools: ["search.web_search"],
    });
    const result = await executor.executePlan([{ tool: "search.web_read", parameters: { url: "https://example.com" } }]);

    expect(result[0].ok).toBe(false);
    expect(result[0].error?.code).toBe("tool_not_whitelisted");
  });

  it("can cascade search results into web reads", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "search.web_search",
      title: "Search",
      description: "Search",
      authority: "network_read",
      inputSchema: z.object({ query: z.string() }),
      sideEffects: sideEffects({ networkAccess: true }),
      execute: vi.fn(() => ({ ok: true, summary: "found", data: { results: [{ url: "https://example.com" }] } })),
    });
    registry.register({
      name: "search.web_read",
      title: "Read",
      description: "Read",
      authority: "network_read",
      inputSchema: z.object({ url: z.string(), max_chars: z.number() }),
      sideEffects: sideEffects({ networkAccess: true }),
      execute: vi.fn(() => ({ ok: true, summary: "read", data: { text: "hello" } })),
    });

    const executor = new CursorToolExecutor({
      tools: registry,
      cursorId: "discord_text_channel",
      allowedAuthority: ["network_read"],
      allowedTools: ["search.web_search", "search.web_read"],
    });
    const result = await executor.executePlan(
      [{ tool: "search.web_search", parameters: { query: "stelle" } }],
      { cascadeSearchRead: true },
    );

    expect(result.map(item => item.name)).toEqual(["search.web_search", "search.web_read"]);
  });
});
