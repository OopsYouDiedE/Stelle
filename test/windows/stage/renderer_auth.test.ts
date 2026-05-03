import { describe, expect, it, vi } from "vitest";
import { allowControlRequest, allowDebugRequest } from "../../../src/windows/stage/renderer/renderer_auth.js";

describe("renderer debug auth", () => {
  it("allows local debug read access without a configured token", () => {
    const res = response();

    const allowed = allowDebugRequest({ enabled: true, requireToken: true }, request("127.0.0.1"), res as any);

    expect(allowed).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("still requires a token for remote debug access", () => {
    const res = response();

    const allowed = allowDebugRequest({ enabled: true, requireToken: true }, request("203.0.113.10"), res as any);

    expect(allowed).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: "debug token is required but not configured" });
  });

  it("accepts the configured debug token for remote access", () => {
    const res = response();

    const allowed = allowDebugRequest(
      { enabled: true, requireToken: true, token: "debug-token" },
      request("203.0.113.10", { token: "debug-token" }),
      res as any,
    );

    expect(allowed).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("does not apply the local debug bypass to control routes", () => {
    const res = response();

    const allowed = allowControlRequest({ requireToken: true }, request("127.0.0.1"), res as any);

    expect(allowed).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: "control token is required but not configured" });
  });
});

function request(remoteAddress: string, query: Record<string, string> = {}) {
  return {
    ip: remoteAddress,
    query,
    socket: { remoteAddress },
    connection: { remoteAddress },
    header: vi.fn(() => undefined),
  };
}

function response() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}
