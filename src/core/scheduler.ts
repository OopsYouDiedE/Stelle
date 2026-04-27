import { eventBus } from "../utils/event_bus.js";

export interface SchedulerOptions {
  liveEnabled?: boolean;
  innerEnabled?: boolean;
  liveTickMs?: number;
  innerTickMs?: number;
}

export class StelleScheduler {
  private liveTimer: NodeJS.Timeout | null = null;
  private innerTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: SchedulerOptions = {}) {}

  start(): void {
    const liveMs = this.options.liveTickMs ?? 1800;
    const innerMs = this.options.innerTickMs ?? 45_000;

    if (this.options.liveEnabled) {
      this.liveTimer = setInterval(() => {
        eventBus.publish({ type: "live.tick", reason: "scheduler_interval" });
      }, liveMs);
    }

    if (this.options.innerEnabled !== false) {
      this.innerTimer = setInterval(() => {
        eventBus.publish({ type: "inner.tick", reason: "scheduler_interval" });
      }, innerMs);
    }
  }

  stop(): void {
    if (this.liveTimer) clearInterval(this.liveTimer);
    if (this.innerTimer) clearInterval(this.innerTimer);
    this.liveTimer = null;
    this.innerTimer = null;
  }
}
