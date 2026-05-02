import { describe, it, expect, vi } from "vitest";
import { createTestToolRegistry } from "../../helpers/test_registry.js";
import { ToolRegistry } from "../../../src/capabilities/tooling/tool_registry.js";
import { z } from "zod";
import type { ToolDefinition } from "../../../src/capabilities/tooling/types.js";

describe("ToolRegistry & Single Call Test", () => {
  it("should correctly register and find tools", () => {
    const registry = new ToolRegistry();
    const mockTool: ToolDefinition = {
      name: "test_tool",
      authority: "readonly",
      description: "A test tool",
      inputSchema: z.object({}),
      execute: vi.fn().mockResolvedValue({ ok: true, summary: "done" }),
    };
    registry.register(mockTool);
    expect(registry.get("test_tool")).toBeDefined();
  });

  it("should prevent unauthorized tool execution", async () => {
    const registry = new ToolRegistry();
    const mockTool: ToolDefinition = {
      name: "restricted_tool",
      authority: "external_write",
      description: "...",
      inputSchema: z.object({}),
      execute: vi.fn().mockResolvedValue({ ok: true, summary: "done" }),
    };
    registry.register(mockTool);

    // 仅允许 readonly 权限，尝试执行 external_write 工具
    const context = { caller: "test", allowedAuthority: ["readonly"], allowedTools: ["restricted_tool"] };

    const result = await registry.execute("restricted_tool", {}, context as any);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("cannot use");
  });

  it("registers OBS control tools", () => {
    const registry = createTestToolRegistry({ live: {} as any });
    expect(registry.get("obs.status")).toBeDefined();
    expect(registry.get("obs.start_stream")).toBeDefined();
    expect(registry.get("obs.stop_stream")).toBeDefined();
    expect(registry.get("obs.set_scene")).toBeDefined();
  });

  it("keeps default registry compatibility after tool module split", () => {
    const registry = createTestToolRegistry({ live: {} as any, discord: {} as any, memory: {} as any });
    expect(registry.get("basic.datetime")?.authority).toBe("readonly");
    expect(registry.get("memory.write_long_term")?.authority).toBe("safe_write");
    expect(registry.get("discord.reply_message")?.authority).toBe("external_write");
    expect(registry.get("live.stream_tts_caption")?.authority).toBe("external_write");
    expect(registry.get("search.web_read")?.authority).toBe("network_read");
  });

  it("requires cursor/core callers to whitelist system.run_command", async () => {
    const registry = createTestToolRegistry();

    const cursorResult = await registry.execute(
      "system.run_command",
      { command: "echo nope" },
      {
        caller: "cursor",
        cwd: process.cwd(),
        allowedAuthority: ["system"],
      },
    );
    expect(cursorResult.ok).toBe(false);
    expect(cursorResult.error?.code).toBe("tool_not_whitelisted");

    const coreResult = await registry.execute(
      "system.run_command",
      { command: "echo nope" },
      {
        caller: "core",
        cwd: process.cwd(),
        allowedAuthority: ["system"],
      },
    );
    expect(coreResult.ok).toBe(false);
    expect(coreResult.error?.code).toBe("tool_not_whitelisted");
  });
});
