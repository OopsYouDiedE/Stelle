import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultToolRegistry } from "../../src/tool.js";

describe("SSRF protection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks private initial URLs before fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const registry = createDefaultToolRegistry();

    const result = await registry.execute("search.web_read", { url: "http://127.0.0.1/admin" }, {
      caller: "runtime",
      cwd: process.cwd(),
      allowedAuthority: ["network_read"],
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("ssrf_blocked");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("revalidates redirect targets and blocks private redirects", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      status: 302,
      ok: false,
      url: "https://1.1.1.1/start",
      headers: new Headers({ location: "http://169.254.169.254/latest/meta-data" }),
      text: vi.fn(),
    } as unknown as Response);
    const registry = createDefaultToolRegistry();

    const result = await registry.execute("search.web_read", { url: "https://1.1.1.1/start" }, {
      caller: "runtime",
      cwd: process.cwd(),
      allowedAuthority: ["network_read"],
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("blocked");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks IPv4-mapped IPv6 loopback URLs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const registry = createDefaultToolRegistry();

    const result = await registry.execute("search.web_read", { url: "http://[::ffff:127.0.0.1]/admin" }, {
      caller: "runtime",
      cwd: process.cwd(),
      allowedAuthority: ["network_read"],
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("ssrf_blocked");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
