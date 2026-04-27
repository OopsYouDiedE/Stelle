import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "../../src/tool.js";

describe("ToolRegistry & Single Call Test", () => {
  it("should correctly register and find tools", () => {
    const registry = new ToolRegistry();
    const mockTool = {
      name: "test_tool",
      description: "A test tool",
      execute: vi.fn().mockResolvedValue({ ok: true, summary: "done" })
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
      execute: vi.fn().mockResolvedValue({ ok: true, summary: "done" })
    };
    (registry as any).register(mockTool as any);

    // 仅允许 readonly 权限，尝试执行 external_write 工具
    const context = { caller: "test", allowedAuthority: ["readonly"], allowedTools: ["restricted_tool"] };
    
    const result = await registry.execute("restricted_tool", {}, context as any);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("cannot use");
  });
});
