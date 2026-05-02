import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "../../src/capabilities/tooling/tool_registry.js";
import { sideEffects } from "../../src/capabilities/tooling/types.js";
import { z } from "zod";

describe("ToolRegistry Stage Protection", () => {
  it("should block non-stage_renderer from calling stage-owned tools", async () => {
    const registry = new ToolRegistry();
    const mockExecute = vi.fn().mockResolvedValue({ ok: true, summary: "Done" });

    registry.register({
      name: "live.set_caption",
      title: "Test",
      description: "Test",
      authority: "external_write",
      inputSchema: z.object({ text: z.string() }),
      sideEffects: sideEffects(),
      execute: mockExecute,
    });

    // 1. Cursor call should fail
    const res1 = await registry.execute(
      "live.set_caption",
      { text: "hi" },
      {
        caller: "cursor",
        cwd: ".",
        allowedAuthority: ["external_write"],
        allowedTools: ["live.set_caption"],
      },
    );
    expect(res1.ok).toBe(false);
    expect(res1.error?.code).toBe("stage_output_required");

    // 2. Stage Renderer call should succeed
    const res2 = await registry.execute(
      "live.set_caption",
      { text: "hi" },
      {
        caller: "stage_renderer",
        cwd: ".",
        allowedAuthority: ["external_write"],
        allowedTools: ["live.set_caption"],
      },
    );
    expect(res2.ok).toBe(true);

    // 3. Debug with bypass should succeed
    const res3 = await registry.execute(
      "live.set_caption",
      { text: "hi" },
      {
        caller: "debug",
        cwd: ".",
        debugBypassStageOutput: true,
        allowedAuthority: ["external_write"],
        allowedTools: ["live.set_caption"],
      },
    );
    expect(res3.ok).toBe(true);
  });

  it("should protect live.stop_output", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "live.stop_output",
      title: "Test",
      description: "Test",
      authority: "external_write",
      inputSchema: z.object({}),
      sideEffects: sideEffects(),
      execute: async () => ({ ok: true, summary: "Done" }),
    });

    const res = await registry.execute(
      "live.stop_output",
      {},
      {
        caller: "cursor",
        cwd: ".",
        allowedAuthority: ["external_write"],
        allowedTools: ["live.stop_output"],
      },
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("stage_output_required");
  });

  it("protects live.panel.push_event as stage-owned output", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn().mockResolvedValue({ ok: true, summary: "pushed" });
    registry.register({
      name: "live.panel.push_event",
      title: "Panel",
      description: "Panel",
      authority: "external_write",
      inputSchema: z.object({ text: z.string() }),
      sideEffects: sideEffects(),
      execute,
    });

    const cursorResult = await registry.execute(
      "live.panel.push_event",
      { text: "incoming" },
      {
        caller: "cursor",
        cwd: ".",
        allowedAuthority: ["external_write"],
        allowedTools: ["live.panel.push_event"],
      },
    );
    expect(cursorResult.ok).toBe(false);
    expect(cursorResult.error?.code).toBe("stage_output_required");

    const stageResult = await registry.execute(
      "live.panel.push_event",
      { text: "visible" },
      {
        caller: "stage_renderer",
        cwd: ".",
        allowedAuthority: ["external_write"],
        allowedTools: ["live.panel.push_event"],
      },
    );
    expect(stageResult.ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("blocks ordinary cursors from direct live.stream_tts_caption but allows stage_renderer", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn().mockResolvedValue({ ok: true, summary: "spoke" });
    registry.register({
      name: "live.stream_tts_caption",
      title: "TTS",
      description: "TTS",
      authority: "external_write",
      inputSchema: z.object({ text: z.string() }),
      sideEffects: sideEffects(),
      execute,
    });

    const cursorResult = await registry.execute(
      "live.stream_tts_caption",
      { text: "hi" },
      {
        caller: "cursor",
        cwd: ".",
        allowedAuthority: ["external_write"],
        allowedTools: ["live.stream_tts_caption"],
      },
    );
    expect(cursorResult.ok).toBe(false);
    expect(cursorResult.error?.code).toBe("stage_output_required");

    const stageResult = await registry.execute(
      "live.stream_tts_caption",
      { text: "hi" },
      {
        caller: "stage_renderer",
        cwd: ".",
        allowedAuthority: ["external_write"],
        allowedTools: ["live.stream_tts_caption"],
      },
    );
    expect(stageResult.ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
