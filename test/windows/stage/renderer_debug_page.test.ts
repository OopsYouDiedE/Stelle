import { describe, expect, it } from "vitest";
import { debugHtml } from "../../../src/windows/stage/renderer/renderer_server.js";

describe("renderer debug page", () => {
  it("renders a dashboard instead of a raw JSON-only page", () => {
    const html = debugHtml();

    expect(html).toContain("<h1>Stelle Debug</h1>");
    expect(html).toContain('id="stats"');
    expect(html).toContain('id="packages"');
    expect(html).toContain("Raw snapshot JSON");
    expect(html).toContain("function render(snapshot)");
  });
});
