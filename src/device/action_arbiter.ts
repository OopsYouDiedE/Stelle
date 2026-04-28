import { DeviceActionRenderer } from "./action_renderer.js";
import type { DeviceActionArbiterDeps, DeviceActionDecision, DeviceActionIntent } from "./action_types.js";

export class DeviceActionArbiter {
  private readonly renderer: DeviceActionRenderer;

  constructor(private readonly deps: DeviceActionArbiterDeps) {
    this.renderer = new DeviceActionRenderer(deps.drivers ?? []);
  }

  async propose(intent: DeviceActionIntent): Promise<DeviceActionDecision> {
    this.publish("device.action.proposed", intent, { reason: "proposed" });

    const riskDecision = this.checkRisk(intent);
    if (!riskDecision.allowed) {
      this.publish("device.action.rejected", intent, { reason: riskDecision.reason });
      return { status: "rejected", reason: riskDecision.reason, intent };
    }

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
