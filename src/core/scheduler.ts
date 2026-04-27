export interface SchedulerOptions {
  liveEnabled?: boolean;
  innerEnabled?: boolean;
  liveTickMs?: number;
  innerTickMs?: number;
}

export class StelleScheduler {
  private liveTimer: NodeJS.Timeout | null = null;
  private innerTimer: NodeJS.Timeout | null = null;
  private tickListener?: (type: string, reason: string) => void;

  constructor(private readonly options: SchedulerOptions = {}) {}

  onTick(listener: (type: string, reason: string) => void): void {
    this.tickListener = listener;
  }

  start(): void {
    const liveMs = this.options.liveTickMs ?? 1800;
    const innerMs = this.options.innerTickMs ?? 45_000;

    if (this.options.liveEnabled) {
      this.liveTimer = setInterval(() => {
        this.tickListener?.("live.tick", "scheduler_interval");
      }, liveMs);
    }

    if (this.options.innerEnabled !== false) {
      this.innerTimer = setInterval(() => {
        this.tickListener?.("inner.tick", "scheduler_interval");
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
