import type { StelleEventBus as EventBus } from "../../core/event/event_bus.js";

export interface PackageHealth {
  packageId: string;
  status: "healthy" | "unhealthy" | "crashed";
  lastHeartbeat: number;
  restartCount: number;
  error?: string;
}

export class Watchdog {
  private health = new Map<string, PackageHealth>();

  constructor(private eventBus: EventBus) {}

  heartbeat(packageId: string): void {
    const record = this.health.get(packageId) || {
      packageId,
      status: "healthy",
      lastHeartbeat: Date.now(),
      restartCount: 0,
    };
    record.lastHeartbeat = Date.now();
    record.status = "healthy";
    this.health.set(packageId, record);
  }

  reportError(packageId: string, error: string): void {
    const record = this.health.get(packageId);
    if (record) {
      record.status = "unhealthy";
      record.error = error;
    }
  }

  getSnapshot(): PackageHealth[] {
    return Array.from(this.health.values());
  }
}
