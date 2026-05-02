import { describe, expect, it, vi } from "vitest";
import { LlmClient } from "../../src/memory/llm.js";

describe("LlmClient.generateJson", () => {
  it("extracts the first JSON object from noisy output", async () => {
    const llm = new LlmClient({} as any);
    vi.spyOn(llm, "generateText").mockResolvedValue('prefix {"ok":true} suffix');

    const result = await llm.generateJson("prompt", "test_schema", (raw) => raw as { ok: boolean });

    expect(result).toEqual({ ok: true });
  });

  it("repairs malformed JSON with secondary model before returning safe default", async () => {
    const llm = new LlmClient({} as any);
    const generateText = vi
      .spyOn(llm, "generateText")
      .mockResolvedValueOnce("{broken")
      .mockResolvedValueOnce('{"ok":true}');

    const result = await llm.generateJson("prompt", "test_schema", (raw) => raw as { ok: boolean }, {
      safeDefault: { ok: false },
    });

    expect(result).toEqual({ ok: true });
    expect(generateText).toHaveBeenLastCalledWith(
      expect.stringContaining("Repair"),
      expect.objectContaining({ role: "secondary" }),
    );
  });

  it("returns the declared safe default after parse and repair fail", async () => {
    const llm = new LlmClient({} as any);
    vi.spyOn(llm, "generateText").mockResolvedValueOnce("{broken").mockResolvedValueOnce("still broken");

    const result = await llm.generateJson("prompt", "test_schema", (raw) => raw as { ok: boolean }, {
      safeDefault: { ok: false },
    });

    expect(result).toEqual({ ok: false });
  });
});
