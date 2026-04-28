import { DeviceActionRenderer } from "./action_renderer.js";
import { DeviceActionIntentSchema } from "./action_types.js";
import type { 
  DeviceActionArbiterDeps, 
  DeviceActionDecision, 
  DeviceActionIntent, 
  DeviceResourceKind,
  DeviceActionRisk,
  DeviceActionKind
} from "./action_types.js";

interface ResourceLease {
  cursorId: string;
  expiresAt: number;
}

const KIND_RISK_MAP: Record<DeviceActionKind, DeviceActionRisk[]> = {
  "observe": ["readonly"],
  "navigate": ["safe_interaction"],
  "click": ["safe_interaction"],
  "scroll": ["safe_interaction"],
  "type": ["text_input"],
  "hotkey": ["safe_interaction", "system"],
  "android_tap": ["safe_interaction"],
  "android_text": ["text_input"],
  "android_back": ["safe_interaction"],
};

export class DeviceActionArbiter {
  private readonly renderer: DeviceActionRenderer;
  private readonly leases = new Map<string, ResourceLease>(); // resourceId -> lease

  constructor(private readonly deps: DeviceActionArbiterDeps) {
    this.renderer = new DeviceActionRenderer(deps.drivers ?? []);
  }

  async propose(input: unknown): Promise<DeviceActionDecision> {
    const now = this.deps.now();
    // 1. Zod Validation
    const validation = DeviceActionIntentSchema.safeParse(input);
    if (!validation.success) {
      const reason = `Invalid intent structure: ${validation.error.message}`;
      return { 
        status: "rejected", 
        reason, 
        intent: input as any 
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

    // 3. Consistency Check (actionKind -> minimum risk)
    const riskLevels: DeviceActionRisk[] = ["readonly", "safe_interaction", "text_input", "external_commit", "system"];
    const minRequiredRisk = KIND_RISK_MAP[intent.actionKind][0]; // Using first element as min required
    const intentRiskIndex = riskLevels.indexOf(intent.risk);
    const minRiskIndex = riskLevels.indexOf(minRequiredRisk);

    if (intentRiskIndex < minRiskIndex) {
      const reason = `Risk level too low: ${intent.actionKind} requires at least ${minRequiredRisk}, but intent has ${intent.risk}.`;
      this.publish("device.action.rejected", intent, { reason });
      return { status: "rejected", reason, intent };
    }

    // 4. Allowlist Check
    const allowlist = this.deps.allowlist;
    if (allowlist) {
      if (allowlist.cursors && !allowlist.cursors.includes(intent.cursorId)) {
        const reason = `Cursor ${intent.cursorId} is not in the allowlist.`;
        this.publish("device.action.rejected", intent, { reason });
        return { status: "rejected", reason, intent };
      }
      if (allowlist.resources && !allowlist.resources.includes(intent.resourceId)) {
        const reason = `Resource ${intent.resourceId} is not in the allowlist.`;
        this.publish("device.action.rejected", intent, { reason });
        return { status: "rejected", reason, intent };
      }
      if (allowlist.risks && !allowlist.risks.includes(intent.risk)) {
        const reason = `Risk ${intent.risk} is not in the allowlist.`;
        this.publish("device.action.rejected", intent, { reason });
        return { status: "rejected", reason, intent };
      }
    }

    // 5. Resource Lease / Focus Lock
    const currentLease = this.leases.get(intent.resourceId);
    if (currentLease && currentLease.expiresAt > now && currentLease.cursorId !== intent.cursorId) {
      const reason = `Resource ${intent.resourceId} is currently locked by ${currentLease.cursorId}.`;
      this.publish("device.action.rejected", intent, { reason });
      return { status: "rejected", reason, intent };
    }

    // 6. Security Approval Check (Existing logic)
    const riskDecision = this.checkRisk(intent);
    if (!riskDecision.allowed) {
      this.publish("device.action.rejected", intent, { reason: riskDecision.reason });
      return { status: "rejected", reason: riskDecision.reason, intent };
    }

    // Accept and acquire lease
    this.leases.set(intent.resourceId, {
      cursorId: intent.cursorId,
      expiresAt: expiresAt
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

  private checkRisk(intent: DeviceActionIntent): { allowed: boolean; reason: string } {
    if (intent.requiresApproval) {
      return { allowed: false, reason: "Action requires explicit approval." };
    }
    if (intent.risk === "system" || intent.risk === "external_commit") {
      return { allowed: false, reason: "High-risk action requires explicit approval." };
    }
    return { allowed: true, reason: "Risk accepted." };
  }

  private publish(type: string, intent: DeviceActionIntent, extra: Record<string, unknown>): void {
    this.deps.eventBus?.publish({
      type: type as any,
      source: "device_action",
      id: `${type}-${intent.id}`,
      timestamp: this.deps.now(),
      payload: { intent, ...extra },
    } as any);
  }
}
