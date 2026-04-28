import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeviceActionArbiter } from "../../src/device/action_arbiter.js";
import { MockDeviceActionDriver } from "../../src/device/drivers/mock_driver.js";
import type { DeviceActionIntent } from "../../src/device/action_types.js";

describe("DeviceActionArbiter", () => {
  let arbiter: DeviceActionArbiter;
  let now = 1000000;

  beforeEach(() => {
    arbiter = new DeviceActionArbiter({
      drivers: [new MockDeviceActionDriver("browser")],
      now: () => now,
      // Default permissive allowlist for base tests
      allowlist: {
        cursors: ["c1", "c2", "browser", "inner"],
        resources: ["r1", "tab1", "default"],
        risks: ["readonly", "safe_interaction", "text_input", "external_commit", "system"]
      }
    });
  });

  it("should reject invalid intent structure", async () => {
    const result = await arbiter.propose({ id: "1" }); // Missing many fields
    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("Invalid intent structure");
  });

  it("should reject expired intent", async () => {
    const intent: DeviceActionIntent = {
      id: "1", cursorId: "c1", resourceId: "r1", resourceKind: "browser",
      actionKind: "observe", risk: "readonly", priority: 1,
      createdAt: now - 5000, ttlMs: 4000, // Expired 1s ago
      reason: "test", payload: {}
    };
    const result = await arbiter.propose(intent);
    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("Intent expired");
  });

  it("should reject risk mismatch (too low)", async () => {
    const intent: DeviceActionIntent = {
      id: "1", cursorId: "c1", resourceId: "r1", resourceKind: "browser",
      actionKind: "type", risk: "readonly", priority: 1, // 'type' requires 'text_input'
      createdAt: now, ttlMs: 5000,
      reason: "test", payload: {}
    };
    const result = await arbiter.propose(intent);
    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("Risk level too low");
  });

  it("should accept minimum required risk", async () => {
    const intent: DeviceActionIntent = {
      id: "1", cursorId: "c1", resourceId: "r1", resourceKind: "browser",
      actionKind: "observe", risk: "readonly", priority: 1,
      createdAt: now, ttlMs: 5000,
      reason: "test", payload: {}
    };
    const result = await arbiter.propose(intent);
    expect(result.status).toBe("completed");
  });

  it("should enforce allowlist for cursors", async () => {
    arbiter = new DeviceActionArbiter({
      drivers: [new MockDeviceActionDriver("browser")],
      now: () => now,
      allowlist: { cursors: ["inner"] }
    });

    const intent: DeviceActionIntent = {
      id: "1", cursorId: "browser", resourceId: "r1", resourceKind: "browser",
      actionKind: "observe", risk: "readonly", priority: 1,
      createdAt: now, ttlMs: 5000,
      reason: "test", payload: {}
    };
    const result = await arbiter.propose(intent);
    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("not in the allowlist");
  });

  it("should enforce allowlist for risks", async () => {
    arbiter = new DeviceActionArbiter({
      drivers: [new MockDeviceActionDriver("browser")],
      now: () => now,
      allowlist: { risks: ["readonly"] }
    });

    const intent: DeviceActionIntent = {
      id: "1", cursorId: "c1", resourceId: "r1", resourceKind: "browser",
      actionKind: "navigate", risk: "safe_interaction", priority: 1,
      createdAt: now, ttlMs: 5000,
      reason: "test", payload: {}
    };
    const result = await arbiter.propose(intent);
    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("not in the allowlist");
  });

  it("should enforce resource lease (focus lock)", async () => {
    const intent1: DeviceActionIntent = {
      id: "1", cursorId: "c1", resourceId: "r1", resourceKind: "browser",
      actionKind: "observe", risk: "readonly", priority: 1,
      createdAt: now, ttlMs: 5000,
      reason: "test", payload: {}
    };
    const intent2: DeviceActionIntent = {
      id: "2", cursorId: "c2", resourceId: "r1", resourceKind: "browser",
      actionKind: "observe", risk: "readonly", priority: 1,
      createdAt: now, ttlMs: 5000,
      reason: "test", payload: {}
    };

    await arbiter.propose(intent1);
    const result = await arbiter.propose(intent2);
    
    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("locked by c1");
  });

  it("should allow new cursor after lease expires", async () => {
    const intent1: DeviceActionIntent = {
      id: "1", cursorId: "c1", resourceId: "r1", resourceKind: "browser",
      actionKind: "observe", risk: "readonly", priority: 1,
      createdAt: now, ttlMs: 1000,
      reason: "test", payload: {}
    };
    const intent2: DeviceActionIntent = {
      id: "2", cursorId: "c2", resourceId: "r1", resourceKind: "browser",
      actionKind: "observe", risk: "readonly", priority: 1,
      createdAt: now + 2000, ttlMs: 5000,
      reason: "test", payload: {}
    };

    await arbiter.propose(intent1);
    
    now += 2000; // Move time forward
    
    const result = await arbiter.propose(intent2);
    expect(result.status).toBe("completed");
  });

  it("should reject high-risk actions without approval", async () => {
    const intent: DeviceActionIntent = {
      id: "1", cursorId: "c1", resourceId: "r1", resourceKind: "browser",
      actionKind: "hotkey", risk: "system", priority: 1,
      createdAt: now, ttlMs: 5000,
      reason: "test", payload: {}
    };
    const result = await arbiter.propose(intent);
    expect(decision_reason_contains(result, "High-risk") || decision_reason_contains(result, "requires explicit approval")).toBe(true);
  });

  it("should reject all when allowlist is missing (default deny)", async () => {
    arbiter = new DeviceActionArbiter({
      drivers: [new MockDeviceActionDriver("browser")],
      now: () => now,
      allowlist: undefined
    });

    const intent: DeviceActionIntent = {
      id: "1", cursorId: "c1", resourceId: "r1", resourceKind: "browser",
      actionKind: "observe", risk: "readonly", priority: 1,
      createdAt: now, ttlMs: 5000,
      reason: "test", payload: {}
    };
    const result = await arbiter.propose(intent);
    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("no allowlist configured");
  });
});

function decision_reason_contains(decision: any, text: string): boolean {
  return (decision.reason || "").includes(text);
}
