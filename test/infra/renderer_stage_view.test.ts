import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("formal live renderer view", () => {
  it("keeps /live standalone mode free of control-room panels", async () => {
    const css = await fs.readFile(path.resolve("assets/renderer/client/src/style.css"), "utf8");

    expect(css).toContain('body[data-scene="standalone"] .panel');
    expect(css).toContain('body[data-scene="standalone"] .stage-topbar');
    expect(css).toContain('body[data-scene="standalone"] .program-layer');
    expect(css).toMatch(/body\[data-scene="standalone"\]\s+\.panel\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/body\[data-scene="standalone"\]\s+\.stage-topbar\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/body\[data-scene="standalone"\]\s+\.program-layer\s*\{[^}]*display:\s*none/s);
  });

  it("does not ship a hard-coded live topic as the renderer empty state", async () => {
    const html = await fs.readFile(path.resolve("assets/renderer/client/index.html"), "utf8");

    expect(html).not.toContain("AI 主播应不应该记住观众");
    expect(html).not.toContain("如果可以一键让 Stelle 忘记你");
    expect(html).toContain("等待议题载入");
  });
});
