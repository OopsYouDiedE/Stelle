import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createDefaultToolRegistry, sideEffects, ToolRegistry } from "../../src/tool.js";

describe("ToolRegistry & Single Call Test", () => {
  it("should correctly register and find tools", () => {
    const registry = new ToolRegistry();
    const mockTool = {
      name: "test_tool",
      description: "A test tool",
      execute: vi.fn().mockResolvedValue({ ok: true, summary: "done" }),
    };
    (registry as any).register(mockTool as any);
    expect(registry.get("test_tool")).toBeDefined();
  });

  it("should prevent unauthorized tool execution", async () => {
    const registry = new ToolRegistry();
    const mockTool = {
      name: "restricted_tool",
      authority: "external_write",
      description: "...",
      execute: vi.fn().mockResolvedValue({ ok: true, summary: "done" }),
    };
    (registry as any).register(mockTool as any);

    // 仅允许 readonly 权限，尝试执行 external_write 工具
    const context = { caller: "test", allowedAuthority: ["readonly"], allowedTools: ["restricted_tool"] };

    const result = await registry.execute("restricted_tool", {}, context as any);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("cannot use");
  });

  it("registers OBS control tools", () => {
    const registry = createDefaultToolRegistry({ live: {} as any });
    expect(registry.get("obs.status")).toBeDefined();
    expect(registry.get("obs.start_stream")).toBeDefined();
    expect(registry.get("obs.stop_stream")).toBeDefined();
    expect(registry.get("obs.set_scene")).toBeDefined();
  });

  it("keeps default registry compatibility after tool module split", () => {
    const registry = createDefaultToolRegistry({ live: {} as any, discord: {} as any, memory: {} as any });
    expect(registry.get("basic.datetime")?.authority).toBe("readonly");
    expect(registry.get("memory.write_long_term")?.authority).toBe("safe_write");
    expect(registry.get("discord.reply_message")?.authority).toBe("external_write");
    expect(registry.get("live.stream_tts_caption")?.authority).toBe("external_write");
    expect(registry.get("search.web_read")?.authority).toBe("network_read");
  });

  it("requires cursor/core callers to whitelist system.run_command", async () => {
    const registry = createDefaultToolRegistry();

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

  it("rate-limits tools inside their configured budget window", async () => {
    const registry = new ToolRegistry({ budgets: { limited: { maxCalls: 1, windowMs: 60_000 } } });
    registry.register({
      name: "limited",
      title: "Limited",
      description: "Limited test tool",
      authority: "readonly",
      inputSchema: z.object({}),
      sideEffects: sideEffects(),
      execute: vi.fn().mockResolvedValue({ ok: true, summary: "ok" }),
    });

    const context = { caller: "system" as const, cwd: process.cwd(), allowedAuthority: ["readonly" as const] };
    expect((await registry.execute("limited", {}, context)).ok).toBe(true);

    const limited = await registry.execute("limited", {}, context);
    expect(limited.ok).toBe(false);
    expect(limited.error?.code).toBe("tool_rate_limited");
  });

  it("opens a circuit after repeated tool failures", async () => {
    const registry = new ToolRegistry({
      budgets: { flaky: { maxCalls: 10, failureThreshold: 2, circuitOpenMs: 60_000 } },
    });
    registry.register({
      name: "flaky",
      title: "Flaky",
      description: "Flaky test tool",
      authority: "readonly",
      inputSchema: z.object({}),
      sideEffects: sideEffects(),
      execute: vi.fn().mockResolvedValue({ ok: false, summary: "nope", error: { code: "nope", message: "nope", retryable: true } }),
    });
    const context = { caller: "system" as const, cwd: process.cwd(), allowedAuthority: ["readonly" as const] };

    await registry.execute("flaky", {}, context);
    await registry.execute("flaky", {}, context);
    const circuit = await registry.execute("flaky", {}, context);

    expect(circuit.ok).toBe(false);
    expect(circuit.error?.code).toBe("tool_circuit_open");
    expect(registry.getHealth().find((item) => item.toolName === "flaky")?.circuitOpenUntil).toBeGreaterThan(Date.now());
  });
});
