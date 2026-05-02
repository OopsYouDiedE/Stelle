// === Imports ===
import { DeviceActionRenderer } from "./renderer.js";
import { DeviceActionIntentSchema } from "./types.js";
import { validateDeviceActionPolicy } from "./policy.js";
import type {
  DeviceActionArbiterDeps,
  DeviceActionArbiterSnapshot,
  DeviceActionDecision,
  DeviceActionIntent,
} from "./types.js";
import { BaseArbiter } from "./base_arbiter.js";

// === Types ===
interface ResourceLease {
  cursorId: string;
  expiresAt: number;
}

// === Main Class ===
export class DeviceActionArbiter extends BaseArbiter<
  DeviceActionIntent,
  DeviceActionDecision,
  DeviceActionArbiterSnapshot
> {
  private readonly renderer: DeviceActionRenderer;
  private readonly leases = new Map<string, ResourceLease>(); // resourceId -> lease

  constructor(deps: DeviceActionArbiterDeps) {
    super("device_action", deps as any);
    this.renderer = new DeviceActionRenderer(deps.drivers ?? []);
  }

  // === Logic ===
  async propose(input: unknown): Promise<DeviceActionDecision> {
    const now = this.deps.now();
    // 1. Zod Validation
    const validation = DeviceActionIntentSchema.safeParse(input);
    if (!validation.success) {
      const reason = `Invalid intent structure: ${validation.error.message}`;
      return {
        status: "rejected",
        reason,
        intent: input as any,
      };
    }
    const intent = validation.data;

    this.publish("device.action.proposed", intent, { reason: "proposed" });

    // 2. Real Expiration Check
    const expiresAt = intent.createdAt + intent.ttlMs;
    if (expiresAt < now) {
      const reason = `Intent expired (expiresAt: ${expiresAt}, now: ${now}).`;
      this.publish("device.action.rejected", intent, { reason });
      return { status: "rejected", reason, intent };
    }

    // 3. Static action policy: resource support, risk, allowlist, payload.
    const policyDecision = validateDeviceActionPolicy(intent, (this.deps as DeviceActionArbiterDeps).allowlist);
    if (!policyDecision.allowed) {
      this.publish("device.action.rejected", intent, { reason: policyDecision.reason });
      return { status: "rejected", reason: policyDecision.reason, intent };
    }

    // 5. Resource Lease / Focus Lock
    const currentLease = this.leases.get(intent.resourceId);
    if (currentLease && currentLease.expiresAt > now && currentLease.cursorId !== intent.cursorId) {
      const reason = `Resource ${intent.resourceId} is currently locked by ${currentLease.cursorId}.`;
      this.publish("device.action.rejected", intent, { reason });
      return { status: "rejected", reason, intent };
    }

    // Accept and acquire lease
    this.leases.set(intent.resourceId, {
      cursorId: intent.cursorId,
      expiresAt: expiresAt,
    });

    this.publish("device.action.accepted", intent, { reason: "accepted" });
    this.publish("device.action.started", intent, { reason: "started" });

    try {
      const result = await this.renderer.render(intent);
      if (!result.ok) {
        this.publish("device.action.failed", intent, { reason: result.summary, result });
        return { status: "failed", reason: result.summary, intent, result };
      }

      this.publish("device.action.completed", intent, { reason: result.summary, result });
      return { status: "completed", reason: result.summary, intent, result };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.publish("device.action.failed", intent, { reason, error: reason });
      return { status: "failed", reason, intent };
    }
  }

  // === Lifecycle & Snapshot ===
  snapshot(): DeviceActionArbiterSnapshot {
    const now = this.deps.now();
    for (const [resourceId, lease] of this.leases) {
      if (lease.expiresAt <= now) this.leases.delete(resourceId);
    }
    return {
      allowlistConfigured: Boolean((this.deps as DeviceActionArbiterDeps).allowlist),
      drivers: this.renderer.driverKinds(),
      leases: [...this.leases.entries()].map(([resourceId, lease]) => ({ resourceId, ...lease })),
    };
  }
}
