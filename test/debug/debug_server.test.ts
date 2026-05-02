import { describe, expect, it, vi } from "vitest";
import { DebugServer } from "../../src/debug/server/debug_server.js";
import { ComponentRegistry } from "../../src/core/runtime/component_registry.js";
import type { DebugProvider } from "../../src/debug/contracts/debug_provider.js";
import { DebugSecurityPolicy } from "../../src/debug/server/debug_auth.js";
import type { ComponentPackage } from "../../src/core/protocol/component.js";

describe("DebugServer", () => {
  it("should list registered providers", async () => {
    const registry = new ComponentRegistry();
    const server = new DebugServer(registry);

    const provider: DebugProvider = {
      id: "test.debug",
      title: "Test",
      ownerPackageId: "pkg.test",
      getSnapshot: () => ({ ok: true }),
    };

    registry.provideDebugProvider(provider);

    const providers = await server.listProviders();
    expect(providers).toContain(provider);
  });

  it("should execute provider commands", async () => {
    const registry = new ComponentRegistry();
    const server = new DebugServer(registry);

    const runSpy = vi.fn().mockResolvedValue({ status: "success" });
    const provider: DebugProvider = {
      id: "test.debug",
      title: "Test",
      ownerPackageId: "pkg.test",
      commands: [{ id: "do_it", title: "Do It", risk: "safe_write", run: runSpy }],
    };

    registry.provideDebugProvider(provider);

    const result = await server.runCommand("test.debug", "do_it", { data: 1 });
    expect(runSpy).toHaveBeenCalledWith({ data: 1 });
    expect(result).toEqual({ status: "success" });
  });

  it("should reject remote external-effect commands by default and audit the decision", async () => {
    const registry = new ComponentRegistry();
    const policy = new DebugSecurityPolicy({
      allowRemote: true,
      localOnly: false,
      trustedTokens: ["token"],
    });
    const server = new DebugServer(registry, policy);

    registry.provideDebugProvider({
      id: "danger.debug",
      title: "Danger",
      ownerPackageId: "pkg.test",
      commands: [{ id: "speak", title: "Speak", risk: "external_effect", run: vi.fn() }],
    });

    await expect(server.runCommand("danger.debug", "speak", {}, { isLocal: false, token: "token" })).rejects.toThrow(
      /risk level/,
    );
    expect(server.getAuditLog()[0]).toMatchObject({ commandId: "speak", allowed: false, reason: "risk_rejected" });
  });

  it("should expose runtime control-plane metadata without reading resource content", () => {
    const registry = new ComponentRegistry();
    const pkg: ComponentPackage = {
      id: "window.debuggable",
      kind: "window",
      version: "1.0.0",
      displayName: "Debuggable Window",
      register: vi.fn(),
    };
    registry.register(pkg);
    registry.markActive(pkg.id);

    const server = new DebugServer(registry, undefined, {
      securityMode: "remote-token",
      listResourceRefs: () => [
        {
          id: "res_1",
          kind: "image",
          ownerPackageId: "window.debuggable",
          createdAt: 1,
          ttlMs: 1000,
          accessScope: "private",
        },
      ],
      listStreamRefs: () => [
        {
          id: "stream_1",
          kind: "video_stream",
          ownerPackageId: "window.debuggable",
          createdAt: 1,
          transport: "memory_ring",
          latestOnly: true,
        },
      ],
      listBackpressureStatus: () => [
        {
          queueId: "window.live.ingress",
          consumerId: "window.live",
          bufferedItems: 1,
          droppedItems: 2,
          lagMs: 0,
          recommendedAction: "drop_low_priority",
        },
      ],
    });

    const snapshot = server.getRuntimeSnapshot();
    expect(snapshot.windows).toEqual(["window.debuggable"]);
    expect(snapshot.packages[0]).toMatchObject({ active: true });
    expect(snapshot.resources[0]).toMatchObject({ id: "res_1", accessScope: "private" });
    expect(snapshot.backpressure[0].droppedItems).toBe(2);
    expect(snapshot.securityMode).toBe("remote-token");
  });
});
